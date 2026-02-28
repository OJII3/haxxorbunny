# イベントフロー

## トリアージ LLM レスポンス形式

トリアージ LLM（高速モデル）は以下の JSON を返す:

```json
{
  "action": "ignore" | "react" | "engage",
  "reasoning": "判定理由",
  "confidence": 0.0〜1.0
}
```

## mood 連動トリアージ

トリアージの判定方針は `sociability + curiosity` の平均値で3段階に切り替わる:

| 範囲 | 方針 | engage | react | ignore |
|------|------|--------|-------|--------|
| `> 0.7` | 積極的 | 迷ったら engage。面白そうな話題にも参加 | 積極的に使う。面白い・共感・応援等 | 完全に無関係な事務連絡のみ |
| `> 0.4` | 普通 | メンション・直接質問・混乱整理のみ | 発言するほどではないが何か感じた時 | 基本はこちら |
| `≤ 0.4` | 控えめ | メンションのみに反応 | 非常に印象的な時だけまれに | 基本はこちら |

**チャンネルカテゴリシステム:** チャンネルの役割をカテゴリで分類し、カテゴリごとに振る舞い（`avg_offset`, `allow_react`, `allow_unsolicited`, `respond_to_bots`, `custom_instructions`）を定義。プリセットカテゴリ: `my-space`（自分の居場所、自発的発言OK）、`observe-only`（観察のみ、リアクションのみ）、`bot-chat`（bot同士の会話）。未分類チャンネルでは全行動を控える（メンション時のみ反応）。メンション時はカテゴリをバイパス。`data/guilds/{guildId}/channel-categories.json` に保存。旧データ（home-channels.json, channel-policies.json）からの自動移行対応。**パイプライン統合:** メンション時にユーザーの意図（「ここで自由に話していいよ」等）を Planning フェーズが判断し、`categorize` アクションでチャンネルを自律的にカテゴライズする。

## イベントフロー（エージェントループ）

```
メッセージ受信 → Bot判定
  ├─ 自分自身 → DB保存のみ
  ├─ 他bot → DB保存 → bot-chatカテゴリ？ → No→スキップ / Yes→ループ防止チェック→処理続行
  └─ 人間 → メンション判定 → 未分類CH+非メンション+非botリプライ→スキップ(**)
                                                    ↓ (それ以外)
                                       DB保存 → markActivity → デバウンスバッファ(3秒)
                                                    ↓ (追加メッセージなし or 15秒超過)
                                       結合コンテンツ生成 → スロットル判定(*) → トリアージLLM(mood連動+カテゴリ振る舞い) → 判定
                                                           (* メンション時はスロットルをバイパス)
                                                           (** DB保存もトリアージも完全スキップ)
  トリアージ結果:
  ├─ ignore:  reflection LLM(flash, fire-and-forget) → personality + memory 更新
  ├─ react:   エージェントループ起動 (triggeredBy: "triage-react", 会話履歴15件, MAX_ITER=3)
  │            → add_reaction / save_memory / do_nothing 等のツールで自律的に反応
  └─ engage:  エージェントループ起動 (自動 typing インジケーター開始)
       ├─ LLM に tools 定義 + SYSTEM_PROMPT + personality + MEMORY + 会話履歴を送信 (stream:true, max_tokens:2048)
       ├─ ストリーミングでチャンクを受信 → content + tool_calls を蓄積・組み立て
       ├─ tool_calls → 各ツール実行 → 結果を LLM に返す → ループ
       ├─ finish_reason=length → 途中切れガードで安全に終了
       └─ finish_reason=stop → 終了（最大5イテレーション）+ typing インジケーター停止

VC参加リクエスト（メンション + キーワード）
  → メンバーがVC在室？ → voiceManager.startSession() → VC参加
    → 音声受信ループ: Opus → PCM → VAD → 無音600ms → STT(Moonshine ASR)
      → エージェントループ(voice モード, MAX_ITER=3, temp=0.6)
        → voice_reply → TTS(VOICEVOX) → WAV → AudioPlayer → Discord
    → 自動退出: 無音5分 / 最大10分 / 全員退出

リアクション受信 → Partial解決 → bot自身除外 → botメッセージのみ → クールダウン(メッセージ+ユーザー: 30秒, ユーザー単位: 60秒)
  → mood.sociability < 0.3 ならスキップ
  → エージェントループ起動 (triggeredBy: "reaction", reactionContext 付き, MAX_ITER=3)

cron (13分) — 高頻度タスク（agentBusy のみチェック）
  ├─ autonomous_post (180分, enabled): アクティブ時間内のみ → 自由行動プロンプト → エージェントループ（95%+ do_nothing）
  ├─ channel_patrol (1440分=1日): 全チャンネルスキャン → bot不在24時間超 かつ 直近人間メッセージ7日以内のチャンネル → patrolReflect（観察モード: 上位3チャンネル、テキスト発言なし、リアクション+記憶+personality更新のみ）
  ├─ goal_check (720分=12時間): アクティブゴールあれば → 内部確認のみ（発言は基本しない）
  └─ custom tasks (各タスクの interval): type=custom のタスクを shouldRunTask → require_active_hours チェック → agentBusy チェック → 全ギルドで selectChannel → customTaskContext 付きエージェントループ実行

cron (2時間) — 低頻度タスク
  ├─ distill_memory (12時間): 蒸留LLM(flash) → 日次記憶集約 + 長期記憶更新 + グローバル記憶昇格 + trimGlobalMemory
  ├─ cleanup_old_memory (24時間): 古い日次ファイルの整理
  └─ dream_processing (24時間): 夢処理LLM(flash) → 記憶連想分析 + 洞察生成
```

## エージェントループのコンテキスト対応

エージェントループは `triggeredBy` と付随するコンテキストに応じて異なるプロンプトを生成する:

| トリガー | コンテキスト | プロンプト内容 |
|---------|-------------|-------------|
| `triage` | `triggerMessage` | 会話履歴 + トリガーメッセージ |
| `triage-react` | `triageReactContext` | 会話履歴15件 + トリガーメッセージ + 「add_reaction / do_nothing」（MAX_ITER=3） |
| `reaction` | `reactionContext` | リアクション情報 + 「反応する？」 |
| `cron` + patrol | (patrolReflect) | 観察モード: patrolReflect() で会話観察 → personality/memory/reaction 更新（エージェントループ不使用） |
| `cron` + `customTaskContext` | `customTaskContext` | カスタムタスクのプロンプト + 直近会話10件 |
| `cron` + `goalContext` | `goalContext` | ゴール情報 + 「アクションを取りたい？」 |
| `cron` (デフォルト) | なし | 自由行動プロンプト（ゴール情報 + ツール案内） |
| `voice` | `voiceContext` | トランスクリプト履歴 + 「voice_reply で返答」（MAX_ITER=3, temp=0.6） |

### 補足

- 同一ユーザーの連続メッセージ（追いメッセージ）はデバウンスバッファで蓄積し、最後のメッセージから3秒後にまとめて処理
- メンションかどうかに関わらず、全メッセージがトリアージを通る統一フロー
- メンション情報はトリアージのコンテキストとして渡され、判断材料として使われる
- トリアージは mood 連動。sociability/curiosity が高いほど積極的に engage
- ignore 時は reflection LLM が人格・記憶を更新（fire-and-forget）
- react 時はエージェントループが起動（triage-react モード）し、LLM が add_reaction 等のツールで自律的に反応
- engage 時はエージェントループが起動し、LLM がツールで自由に行動
