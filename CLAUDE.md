# haxxorbunny

Discord に住む自律的エージェント bot。LLM (aiclient-2-api 経由 Gemini) を使い、Tool-Use（関数呼び出し）方式で自律的に行動する。

Main branch: `main`

## 技術スタック

- Runtime: Bun
- 言語: TypeScript (strict)
- Discord: discord.js v14
- LLM: OpenAI SDK → aiclient-2-api (OpenAI 互換エンドポイント)
- Voice: @discordjs/voice + opusscript (純JS Opus)
- STT: whisper.cpp サーバー (Docker)
- TTS: VOICEVOX Engine (Docker)
- DB: SQLite (bun:sqlite + Drizzle ORM)
- Linter/Formatter: Biome
- デプロイ: Podman Compose

## コマンド

- `nr dev` — 開発サーバー (watch mode)
- `nr start` — 本番起動
- `nr typecheck` — 型チェック (`tsc --noEmit`)
- `nr lint` — Lint (`biome check .`)
- `nr lint:fix` — Lint 自動修正 (`biome check --write .`)
- `nr db:generate` — Drizzle マイグレーション生成
- `nr db:migrate` — Drizzle マイグレーション実行

## ディレクトリ構成

```
├── biome.json            # Biome linter/formatter 設定
├── compose.yaml          # Podman Compose 設定
├── Containerfile         # コンテナイメージビルド定義
├── drizzle.config.ts     # Drizzle ORM マイグレーション設定
├── flake.nix             # Nix Flake 開発環境定義
├── package.json          # 依存関係 + npm scripts
├── tsconfig.json         # TypeScript コンパイラ設定
src/
├── index.ts              # エントリポイント
├── client.ts             # Discord Client (GuildMembers intent 含む)
├── config.ts             # 環境変数
├── data/
│   └── paths.ts          # ギルドごとのデータパスユーティリティ
├── agent/
│   ├── types.ts          # AgentContext, ToolResult, ToolHandler 等の型定義
│   ├── loop.ts           # エージェントループ本体 (MAX_ITERATIONS=10, ギルドごとに busy 管理, streaming + max_tokens:2048)
│   └── tools/
│       ├── index.ts      # ツールレジストリ（定義集約 + 名前→ハンドラ Map）
│       ├── discord.ts    # Discord 操作ツール群
│       ├── memory.ts     # 記憶・人格更新ツール群
│       ├── goals.ts      # ゴール管理ツール群
│       ├── heartbeat.ts  # スケジュール管理ツール群 (独り言の頻度調整)
│       ├── avatar.ts     # プロフィール画像管理ツール群
│       ├── web.ts        # Web検索・URL取得ツール群
│       └── voice.ts      # ボイスチャットツール群 (voice_reply, leave_voice)
├── voice/
│   ├── constants.ts      # サンプルレート、VAD パラメータ等の定数
│   ├── audio-utils.ts    # PCM↔WAV 変換、RMS 音量計算
│   ├── stt.ts            # whisper.cpp HTTP クライアント (STT)
│   ├── tts.ts            # VOICEVOX HTTP クライアント (TTS)
│   ├── receiver.ts       # 音声受信 + VAD (Voice Activity Detection)
│   ├── session.ts        # VoiceSession (VC接続、STT→Agent→TTS パイプライン)
│   └── manager.ts        # VoiceSessionManager (ギルドごとに1セッション)
├── discord/
│   ├── events/           # messageCreate, ready, messageReactionAdd, voiceStateUpdate
│   └── register.ts       # イベント登録
├── llm/
│   ├── client.ts         # メイン LLM OpenAI SDK ラッパー
│   ├── triage-client.ts  # トリアージ LLM 専用クライアント
│   ├── triage.ts         # トリアージ判定ロジック (mood連動の動的3段階方針)
│   ├── triage-throttle.ts # チャンネルごとのスロットリング
│   ├── reflection.ts     # triage後の軽量reflection (人格・記憶更新)
│   ├── memory.ts         # 記憶管理 (load/save/append/toPrompt + 感情スコアリング)
│   ├── goals.ts          # ゴール管理 (CRUD + goalsToPrompt)
│   ├── heartbeat.ts      # 定期タスク管理 + アクティブ時間帯判定
│   ├── distill.ts        # 記憶蒸留 (日次→長期)
│   ├── dream.ts          # 夢処理 (記憶の連想分析・洞察生成)
│   ├── message-buffer.ts # 追いメッセージのデバウンスバッファ (channelId:userId 単位)
│   ├── message-dedup.ts  # メッセージ重複抑制 (SHA-256 + 24時間キャッシュ)
│   ├── avatar.ts         # アバター管理 (マニフェスト読み込み, ステート管理, クールダウン判定)
│   └── prompts/
│       ├── system.ts     # SURFACE_PROMPT (軽量要約) + SOUL_PROMPT (不変の本質) + IDENTITY_PROMPT (行動指針)
│       └── personality.ts # 可変プロンプト (4次元気分ベクトル + personality.json)
├── scheduler/
│   ├── index.ts          # cron スケジューラー (13分 + 2時間 の2系統)
│   ├── cron.ts           # 高頻度/低頻度タスク分離実行
│   ├── patrol.ts         # チャンネル巡回ロジック
│   └── goal-check.ts     # ゴールチェック cronタスク
└── db/
    ├── index.ts          # DB 接続
    ├── schema.ts         # Drizzle スキーマ
    ├── migrate.ts        # テーブル作成
    └── queries.ts        # クエリヘルパー
data/
├── heartbeat.json        # HEARTBEAT: グローバル定期タスク設定
├── personality.json      # レガシー (migrate-to-guild.ts で guilds/ に移行)
├── memory.json           # レガシー (同上)
├── goals.json            # レガシー (同上)
├── guilds/               # ギルドごとのデータ (移行後に自動作成)
│   └── {guildId}/
│       ├── personality.json  # SOUL: 可変プロンプト (bot が自己更新可能)
│       ├── memory.json       # MEMORY: 長期記憶 (bot が自動更新)
│       ├── goals.json        # GOALS: ゴール管理 (bot が自己更新可能)
│       └── memory/           # 日次記憶蒸留
│           └── YYYY-MM-DD.json
├── avatars/              # アバター画像 + メタデータ
│   └── manifest.json     # アバター定義（ID, ファイル名, 名前, 説明, タグ）
├── avatar-state.json     # アバター状態（実行時生成, gitignore）
├── haxxorbunny.db        # SQLite DB (gitignore)
scripts/
└── migrate-to-guild.ts   # 既存データ移行スクリプト
```

## アーキテクチャ

### Tool-Use Agent 方式

メイン LLM は OpenAI Function Calling (tools) を使って行動する。JSON レスポンスのパースではなく、LLM がツール（関数）を呼び出すことで Discord を操作する。

**利点:**
- LLM が Discord を人間のように自由に操作できる
- 1ターンで複数アクション実行可能（リアクション + 返信 + メモリ保存 等）
- ツール定義を追加するだけで新機能を拡張可能

### ツール一覧

**Discord ツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `send_message` | `content` | チャンネルにメッセージ送信 |
| `reply_to_message` | `content` | トリガーメッセージへの返信 |
| `add_reaction` | `emoji` | リアクション追加 |
| `edit_message` | `message_id`, `content` | bot のメッセージを編集 |
| `delete_message` | `message_id` | メッセージを削除 |
| `create_thread` | `name`, `message_id?` | スレッド作成 |
| `send_embed` | `title`, `description?`, `color?`, `fields?` | Embed 送信 |
| `pin_message` | `message_id` | メッセージをピン |
| `unpin_message` | `message_id` | ピン解除 |
| `fetch_messages` | `channel_id?`, `limit?` | メッセージ履歴取得 |
| `get_channel_info` | `channel_id?` | チャンネル情報取得 |
| `get_user_info` | `user_id` | ユーザー情報取得 |
| `list_channels` | (なし) | サーバーのチャンネル一覧 |
| `set_typing` | (なし) | 入力中表示 |
| `do_nothing` | `reasoning` | 何もしない（理由を記録） |

**記憶・人格ツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `recall_identity` | (なし) | SOUL_PROMPT + IDENTITY_PROMPT の全文を参照（行動に迷った時に呼ぶ） |
| `save_memory` | `entry`, `emotional_impact?` | 長期記憶に保存（30字以内、感情インパクト1-5） |
| `save_user_note` | `username`, `note` | ユーザーメモ保存 |
| `update_personality` | `mood?`, `recent_topics?`, `interests?` | 性格設定更新（mood は4次元ベクトル） |

**ゴール管理ツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `set_goal` | `title`, `description`, `priority?` | 新しい目標を設定（最大5つ） |
| `update_goal_progress` | `goal_id`, `note` | 目標の進捗メモを追加 |
| `complete_goal` | `goal_id` | 目標を達成済みにする |
| `list_goals` | (なし) | アクティブな目標一覧 |

**Web検索・取得ツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `web_search` | `query` | SearXNG API でWeb検索（上位5件） |
| `fetch_url` | `url` | URLの内容を取得（HTML→テキスト変換、2000字制限） |

**ボイスチャットツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `voice_reply` | `content` | ボイスチャンネルで音声として返答（TTS再生、50文字以内推奨） |
| `leave_voice` | (なし) | ボイスチャンネルから退出する |

**スケジュール管理ツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `get_posting_schedule` | (なし) | 独り言の現在の設定（enabled, interval_minutes）を返す |
| `update_posting_schedule` | `enabled?`, `interval_minutes?` | 独り言の頻度を変更。interval は 15〜1440 分の範囲 |

**プロフィール画像ツール:**

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `list_avatars` | (なし) | 使用可能なアバター一覧（ID, 名前, 説明, タグ, 現在のアバター表示）|
| `change_avatar` | `avatar_id`, `reason` | アバター変更（reason 必須で記録。30分クールダウンあり）|
| `get_avatar_status` | (なし) | 現在のアバター + クールダウン残り時間 |

### トリアージ LLM レスポンス形式

トリアージ LLM（高速モデル）は以下の JSON を返す:

```json
{
  "action": "ignore" | "engage",
  "reasoning": "判定理由",
  "confidence": 0.0〜1.0
}
```

### mood 連動トリアージ

トリアージの判定方針は `sociability + curiosity` の平均値で3段階に切り替わる:

| 範囲 | 方針 | 説明 |
|------|------|------|
| `> 0.7` | 積極的 | 迷ったら engage。面白そうな話題にも参加 |
| `> 0.4` | 普通 | メンション・直接質問・混乱整理のみ engage |
| `≤ 0.4` | 控えめ | メンションのみに反応 |

### イベントフロー（エージェントループ）

```
メッセージ受信 → DB保存 → Bot除外 → markActivity → デバウンスバッファ(3秒)
                                                    ↓ (追加メッセージなし or 15秒超過)
                                       結合コンテンツ生成 → スロットル判定(*) → トリアージLLM(mood連動) → 判定
                                                           (* メンション時はスロットルをバイパス)
  トリアージ結果:
  ├─ ignore:  reflection LLM(flash, fire-and-forget) → personality + memory 更新
  └─ engage:  エージェントループ起動 (自動 typing インジケーター開始)
       ├─ LLM に tools 定義 + SURFACE + personality + MEMORY + 会話履歴を送信 (軽量構成, stream:true, max_tokens:2048)
       ├─ ストリーミングでチャンクを受信 → content + tool_calls を蓄積・組み立て
       ├─ tool_calls → 各ツール実行 → 結果を LLM に返す → ループ
       ├─ LLM が必要時に recall_identity ツールで SOUL + IDENTITY の詳細を参照
       ├─ finish_reason=length → 途中切れガードで安全に終了
       └─ finish_reason=stop → 終了（最大10イテレーション）+ typing インジケーター停止

VC参加リクエスト（メンション + キーワード）
  → メンバーがVC在室？ → voiceManager.startSession() → VC参加
    → 音声受信ループ: Opus → PCM → VAD → 無音600ms → STT(whisper.cpp)
      → エージェントループ(voice モード, MAX_ITER=3, temp=0.6)
        → voice_reply → TTS(VOICEVOX) → WAV → AudioPlayer → Discord
    → 自動退出: 無音5分 / 最大10分 / 全員退出

リアクション受信 → Partial解決 → bot自身除外 → botメッセージのみ → クールダウン(30秒)
  → mood.sociability < 0.3 ならスキップ
  → エージェントループ起動 (triggeredBy: "reaction", reactionContext 付き)

cron (13分) — 高頻度タスク（agentBusy のみチェック）
  ├─ autonomous_post (60分, disabled): アクティブ時間内のみ → 自由行動プロンプト → エージェントループ
  ├─ channel_patrol (30分): 全チャンネルスキャン → bot不在10分超のチャンネル → エージェントループ
  └─ goal_check (120分): アクティブゴールあれば → ゴールコンテキスト付きエージェントループ

cron (2時間) — 低頻度タスク
  ├─ distill_memory (12時間): 蒸留LLM(flash) → 日次記憶集約 + 長期記憶更新
  ├─ cleanup_old_memory (24時間): 古い日次ファイルの整理
  └─ dream_processing (24時間): 夢処理LLM(flash) → 記憶連想分析 + 洞察生成
```

### エージェントループのコンテキスト対応

エージェントループは `triggeredBy` と付随するコンテキストに応じて異なるプロンプトを生成する:

| トリガー | コンテキスト | プロンプト内容 |
|---------|-------------|-------------|
| `triage` | `triggerMessage` | 会話履歴 + トリガーメッセージ |
| `reaction` | `reactionContext` | リアクション情報 + 「反応する？」 |
| `cron` + `patrolContext` | `patrolContext` | チャンネルの会話 + 「反応したいことがあれば」 |
| `cron` + `goalContext` | `goalContext` | ゴール情報 + 「アクションを取りたい？」 |
| `cron` (デフォルト) | なし | 自由行動プロンプト（ゴール情報 + ツール案内） |
| `voice` | `voiceContext` | トランスクリプト履歴 + 「voice_reply で返答」（MAX_ITER=3, temp=0.6） |

- 同一ユーザーの連続メッセージ（追いメッセージ）はデバウンスバッファで蓄積し、最後のメッセージから3秒後にまとめて処理
- メンションかどうかに関わらず、全メッセージがトリアージを通る統一フロー
- メンション情報はトリアージのコンテキストとして渡され、判断材料として使われる
- トリアージは mood 連動。sociability/curiosity が高いほど積極的に engage
- ignore 時は reflection LLM が人格・記憶を更新（fire-and-forget）
- engage 時はエージェントループが起動し、LLM がツールで自由に行動

### 人間らしさシステム

- **アクティブ時間帯**: 8時〜翌2時（JST）のみ自主発言・チャンネル巡回。深夜は活動休止
- **重複発言抑制**: SHA-256 + 冒頭50文字ハッシュで24時間キャッシュ。cron トリガー時のみチェック
- **4次元気分ベクトル**: energy/positivity/sociability/curiosity (各0-1)。時間帯で energy 自動変動、急変防止の補間（70% new + 30% old）
- **感情付き記憶**: MemoryEntry に emotional_impact (1-5) + created_at。エビングハウス忘却曲線（30日半減期）でスコアリング
- **夢処理**: 24時間ごとに記憶を連想分析。洞察を [dream] タグ付き記憶として追加、不要記憶を整理
- **プロンプト階層化**: 軽量な SURFACE_PROMPT を毎回送信、詳細な SOUL_PROMPT + IDENTITY_PROMPT は recall_identity ツールでオンデマンド参照。トークン消費を ~1250t 削減
- **メッセージデバウンス**: 同一 channelId:userId の連続メッセージを3秒（`MESSAGE_BUFFER_MS`）蓄積。最大15秒（`MESSAGE_BUFFER_MAX_MS`）で強制フラッシュ。結合コンテンツとしてトリアージに渡す
- **自動 typing インジケーター**: エージェントループ中は5秒間隔で sendTyping() を呼び、Discord 上に「入力中…」を表示
- **ゴール駆動行動**: bot が自分で目標を設定し、cron で定期的に進捗確認・アクション実行
- **チャンネル巡回**: bot が不在のチャンネルを定期的にスキャンし、会話があれば参加を検討
- **メンション記憶強化**: メンション（直接の呼びかけ）による指示・依頼は忘れにくくする。AgentContext に `isMentioned` を伝播し、①システムプロンプトで save_memory を促す、②emotional_impact の最低値を 3 にフロアリング。30日後のスコアが impact=2 の ~0.425 → impact=3 の ~0.500 以上に改善
- **自律的スケジュール調整**: bot が `get_posting_schedule` / `update_posting_schedule` ツールで独り言（autonomous_post）の頻度を自分で調整可能。気分や状況に応じて有効/無効の切り替えや間隔（15〜1440分）の変更ができる
- **自律的プロフィール画像変更**: bot が `list_avatars` / `change_avatar` / `get_avatar_status` ツールでプロフィール画像を自律的に変更可能。30分のクールダウンで頻繁な変更を防止。変更履歴（直近20件）を記録。画像は `data/avatars/` に配置し `manifest.json` で管理
- **LLM ストリーミング応答**: エージェントループの LLM 呼び出しは `stream: true` + `max_tokens: 2048` で動作。チャンクから content と tool_calls を index ベースで蓄積・組み立て。aiclient-2-api のバッファリング遅延を回避し TTFB を改善。ストリームエラー・空レスポンス・max_tokens 途中切れのガード付き

### ギルドごとのデータ分離

personality.json / memory.json / goals.json はギルド（Discord サーバー）ごとに `data/guilds/{guildId}/` に保存され、各サーバーで独立したパーソナリティ・記憶・ゴールを維持する。

| 項目 | スコープ | 理由 |
|------|---------|------|
| personality.json | ギルドごと | サーバーごとに独立した人格 |
| memory.json | ギルドごと | サーバーごとに独立した記憶 |
| goals.json | ギルドごと | サーバーごとに独立した目標 |
| heartbeat.json | グローバル | タスクスケジュールはボット全体の設定 |
| avatars/manifest.json | グローバル | アバター画像定義はボット全体の設定 |
| avatar-state.json | グローバル | アバター状態（変更は全サーバー共通） |
| isAgentBusy | ギルドごと | 複数ギルドで同時にエージェント実行可能 |
| message-dedup | guildId をハッシュに含む | ギルド間で同じ発言を許可 |
| DB (messages, bot_actions) | guild_id カラム | ギルド限定クエリに対応 |

**移行**: 既存データは `bun run scripts/migrate-to-guild.ts <guildId>` で移行可能。

### DB テーブル

- `messages` — 全チャンネルの会話ログ (guild_id カラムあり)
- `bot_actions` — bot の行動ログ (action, reasoning, triggeredBy, guild_id)

## 環境変数

`.env.example` 参照。必須: `DISCORD_TOKEN`, `DISCORD_APP_ID`

## デプロイ（Podman Compose / ローカル）

### 前提条件

- `podman` & `podman-compose` がインストール済み
- `.env` ファイルがプロジェクトルートに存在（`.env.example` を参照して作成）
- `~/.gemini/` に Gemini 認証情報（`oauth_creds.json` 等）が存在
- Discord Developer Portal で `GuildMembers` Privileged Intent を有効化
- ボイスチャット使用時: VOICEVOX Engine と whisper.cpp サーバーが起動済み（compose.yaml で自動起動）

### デプロイコマンド

```bash
# 起動（ビルド込み・バックグラウンド）
podman-compose up --build -d

# 停止
podman-compose down

# 再デプロイ（停止→ビルド→起動）
podman-compose down && podman-compose up --build -d

# ログ確認
podman logs haxxorbunny          # bot
podman logs haxxorbunny-aiclient # LLM API

# ステータス確認
podman-compose ps
```

### サービス構成

| サービス | コンテナ名 | 説明 |
|---------|-----------|------|
| bot | haxxorbunny | Discord bot 本体 (Bun) |
| aiclient | haxxorbunny-aiclient | LLM API (aiclient-2-api, Gemini) |
| searxng | haxxorbunny-searxng | Web検索エンジン (SearXNG) |
| voicevox | haxxorbunny-voicevox | TTS Engine (VOICEVOX, CPU) |
| whisper | haxxorbunny-whisper | STT Server (whisper.cpp, small model) |

### データ永続化

- `bot-data` ボリューム → `/app/data`（SQLite DB, heartbeat.json, guilds/{guildId}/personality.json, memory.json, goals.json, memory/）
- `aiclient-configs` ボリューム → aiclient 設定

## コーディング規約

- Formatter: Biome (tab インデント)
- import 順序: Biome の organizeImports に従う
- コード変更後は必ず `nr typecheck && nr lint` で確認
- コード変更後はユーザーに言われる前に自発的に commit → push → PR 作成まで一連で行うこと
  - commit: 変更をこまめにコミット
  - push: コミット後は必ず push
  - PR 作成: 作業ブランチなら `/create-pr` スキルで PR を作成
- CLAUDE.md はプロジェクトのドキュメントとして常に最新に保つこと
- ユーザーが「merge」と言った場合、該当 PR をマージし、最新の main ブランチに戻ること（`gh pr merge` → `git checkout main && git pull`）
