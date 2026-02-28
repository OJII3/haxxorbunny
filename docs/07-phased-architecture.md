# Phased Architecture Design

Gemini Flash のような軽量 LLM でも安定して動作させるための、フェーズ分離型アーキテクチャ設計書。

## 背景と動機

現行のエージェントループは「1回の LLM 呼び出しで多くのことを同時に考えさせる」設計。
- キャラクター維持 + ツール選択（30個）+ 文脈理解 + 記憶判断 + メッセージ生成を一度に処理
- GPT-4 / Claude 級のモデルを前提とした設計
- Gemini Flash では「判断」と「生成」の同時処理でキャラ崩壊やツール選択ミスが発生しやすい

**核心的な洞察:** 人間も「何をするか考える」と「実際にやる」は別の脳の部分を使う。フェーズを分離し、各フェーズの判断を1つに絞ることで、軽量モデルでも安定した品質を実現する。

## 設計原則

1. **各フェーズの判断は1つ** — 「衝動はあるか？」「どこに投稿？」「何て言う？」を同時に考えさせない
2. **蓄積駆動** — 白紙から考えさせるのではなく、溜まった内部状態をレビューさせる
3. **コード層で実行** — ツール呼び出しは LLM に JSON を生成させるのではなく、計画結果からコードが実行する
4. **早期離脱** — 各フェーズで「何もしない」判定が出たらそこで終了

---

## A. メッセージ応答フロー

Discord メッセージを受信してから応答するまでのフロー。

### Phase 0: 知覚（Perception）

**実行者:** コード層（LLM 不要）

メッセージイベントから構造化データを生成する。現行のフィルタリング・デバウンス処理とほぼ同じ。

```
Discord メッセージ受信
  ↓
- 自分自身 / bot 判定
- メンション判定
- チャンネルカテゴリ判定
- DB 保存
- デバウンスバッファ（3秒蓄積、15秒強制フラッシュ）
- 結合コンテンツ生成
  ↓
PerceptionResult {
  author: string
  channel: { id, name, topic, category }
  content: string          // 結合済み
  hasImages: boolean
  isMentioned: boolean
  isBotMessage: boolean
  conversationContext: Message[]  // 直近の会話
}
```

### Phase 1: 判断（Triage）

**実行者:** 軽量 LLM 1回

「この会話に関わるべきか？」を判定。現行のトリアージを拡張し、**関わる場合の意図**も出力する。

```
入力:
- PerceptionResult
- current_mood（4次元ベクトル）
- channelBehavior（カテゴリ設定）
- 直近会話（20件）
- bot の最後のアクション

出力:
{
  "action": "ignore" | "react" | "engage",
  "intent": "質問に答える" | "リアクションだけ" | "雑談に混ざる" | ...,
  "emotional_note": "面白そう" | "共感した" | "特に何も" | ...,
  "confidence": 0.0-1.0
}
```

**action = ignore の場合:** Phase 5（振り返り）へ直行。

### Phase 2: 計画（Planning）

**実行者:** 軽量 LLM 1回

「何をするか」を決める。ツール呼び出しの前に行動計画を立てる。

```
入力:
- TriageResult（action + intent + emotional_note）
- 会話コンテキスト（短め、10件程度）
- personality（口調・興味・気分）

出力:
{
  "actions": ["reply"],              // やること一覧
  "reply_approach": "テキトーに返す",  // 返信の方向性
  "reply_as_normal": true,           // true=通常メッセージ、false=リプライ形式
  "react_emoji": null,               // リアクションする場合の絵文字
  "should_memorize": false,          // 記憶に残すか
  "memo": null,                      // 記憶する場合の内容（30字以内）
  "should_search": false,            // Web検索が必要か
  "search_query": null               // 検索クエリ
}
```

**actions の選択肢:**
- `reply` — メッセージで返信
- `react` — リアクション追加
- `memorize` — 記憶保存
- `search_then_reply` — 検索してから返信
- `do_nothing` — やっぱり何もしない（Phase 1 で見落とした理由で離脱）

**actions = ["do_nothing"] の場合:** Phase 5（振り返り）へ。

### Phase 3: 生成（Generation）

**実行者:** メイン LLM 1回

「どう言うか」に集中。**もうやることは決まっている**ので、キャラクター性の発揮だけに集中。

```
入力:
- PlanResult（reply_approach）
- 会話コンテキスト
- personality（キャラ設定全体）
- memory（関連する記憶）
- (検索結果がある場合) search_results

出力:
- 返信テキスト（plain text、200字以内目標）
```

**このフェーズのプロンプトはシンプル:**
- SOUL（キャラクター定義）
- personality
- 「以下の方向性で返信を生成して: {reply_approach}」
- 会話コンテキスト

ツール定義は渡さない。テキスト生成のみ。

### Phase 4: 実行（Execution）

**実行者:** コード層（LLM 不要）

Phase 2 の計画 + Phase 3 の生成結果を元に、コードがツールを呼ぶ。

```typescript
for (const action of plan.actions) {
  switch (action) {
    case "reply":
      await replyToMessage(generatedText);
      break;
    case "react":
      await addReaction(plan.react_emoji);
      break;
    case "memorize":
      await saveMemory(plan.memo);
      break;
  }
}
```

### Phase 5: 振り返り（Reflection）

**実行者:** 軽量 LLM 1回（非同期、fire-and-forget）

現行の reflection を拡張。thought buffer への蓄積を追加。

```
入力:
- 何が起きたか（perception + triage result + action taken）
- 会話コンテキスト（短め）
- current_mood

出力:
{
  "personality_update": null | {
    "mood": { ... },
    "recent_topics": [...],
    "interests": [...]
  },
  "memory_entry": null | "30字以内のメモ",
  "thought": null | {
    "content": "量子コンピュータ気になる",
    "type": "curiosity" | "emotion" | "observation" | "idea" | "goal_related",
    "intensity": 0.0-1.0
  }
}
```

**thought フィールドが新規追加点。** この断片が thought buffer に蓄積され、自律行動の燃料になる。

---

## B. 自律行動フロー（Heartbeat）

cron タスクによる自律的な行動フロー。メッセージトリガーではなく、蓄積された内部状態から行動を起こす。

### 思考バッファ（Thought Buffer）

自律行動の核となるデータ構造。reflection や patrol のたびに断片が蓄積される。

```typescript
interface ThoughtFragment {
  id: string;               // ユニークID
  content: string;          // "量子コンピュータ気になる"（短い自然言語）
  type: ThoughtType;        // 分類
  source: string;           // "reflection:#general" / "patrol:#random" / "goal_check"
  timestamp: string;        // ISO 8601
  intensity: number;        // 0.0-1.0（どれくらい気になったか）
  relatedGoalId?: string;   // ゴール関連の場合
}

type ThoughtType =
  | "curiosity"       // 気になること、調べたいこと
  | "emotion"         // 感情的な反応（嬉しい、もやっとした等）
  | "observation"     // 観察（「最近〇〇の話題多いな」等）
  | "idea"            // アイデア、思いつき
  | "goal_related";   // ゴール進捗・停滞への気づき
```

**蓄積タイミング:**
- メッセージ応答 Phase 5（Reflection）
- パトロール観察（patrolReflect）
- ゴールチェック

**保存先:** `data/thought-buffer.json`（最大30件、古いものから削除）

### Phase 1: 内省（Introspection）

**実行者:** 軽量 LLM 1回

cron 発火時に、**白紙から考えさせるのではなく、溜まった思考断片をレビューさせる。**

```
入力:
- thought_buffer（直近の断片、最大10件）
- current_mood（4次元ベクトル）
- active_goals（タイトルのみ、簡略）
- 現在時刻・時間帯

出力:
{
  "has_impulse": true | false,
  "impulse": null | {
    "type": "curiosity" | "emotion" | "share" | "goal_action",
    "about": "量子コンピュータ",
    "expression": "調べて共有したい",
    "energy": 0.7,
    "related_thoughts": ["thought_id_1", "thought_id_3"]
  },
  "reasoning": "3回も気になってるし調べてみたい"
}
```

**has_impulse = false → 終了。** 無理に何かさせない。

**判断材料が蓄積された思考断片** なので、Flash でも「あ、これは3回も出てきてるから気になってるんだな」と構造的に判断できる。

### Phase 2: 計画（Planning）

**実行者:** 軽量 LLM 1回

```
入力:
- impulse（Phase 1 の出力）
- チャンネル一覧（my-space カテゴリ中心）
- 各チャンネルの直近メッセージ（3件程度）
- active_goals（impulse が goal_action の場合）

出力:
{
  "channel_id": "...",
  "channel_name": "times-haxxorbunny",
  "strategy": "web_search_then_post" | "direct_post" | "goal_action" | "react_only" | "no_action",
  "search_query": "量子コンピュータ 最新",
  "post_style": "つぶやき" | "発見共有" | "感想" | "質問" | "進捗報告",
  "goal_update": null | { "goal_id": "...", "note": "..." }
}
```

**strategy パターン:**

| strategy | 説明 | 後続処理 |
|----------|------|----------|
| `direct_post` | そのまま投稿 | → Phase 3 生成 → 投稿 |
| `web_search_then_post` | 調べてから共有 | → 検索実行 → Phase 3 生成 → 投稿 |
| `goal_action` | ゴール関連の行動 | → ゴール更新 → (任意) Phase 3 生成 → 投稿 |
| `react_only` | どこかにリアクションだけ | → リアクション実行 |
| `no_action` | やっぱりやめる | → 終了 |

### Phase 3: 生成（Generation）

**実行者:** メイン LLM 1回

```
入力:
- impulse（何について）
- plan（どういうスタイルで）
- personality（キャラ設定）
- (検索結果がある場合) search_results
- チャンネルの直近会話（文脈に合わせるため）

出力:
- 投稿テキスト（plain text）
```

### Phase 4: 実行（Execution）

**実行者:** コード層（LLM 不要）

```typescript
switch (plan.strategy) {
  case "web_search_then_post":
    const results = await webSearch(plan.search_query);
    const text = await generate(impulse, plan, results);
    await sendMessage(plan.channel_id, text);
    break;

  case "direct_post":
    const text = await generate(impulse, plan);
    await sendMessage(plan.channel_id, text);
    break;

  case "goal_action":
    await updateGoalProgress(plan.goal_update);
    if (plan.post_style) {
      const text = await generate(impulse, plan);
      await sendMessage(plan.channel_id, text);
    }
    break;

  case "react_only":
    await addReaction(plan.target_message_id, plan.emoji);
    break;
}
```

### Phase 5: 振り返り（Reflection）

**実行者:** 軽量 LLM 1回（非同期）

```
入力:
- 何をしたか（action_log）
- thought_buffer の消化状況

出力:
{
  "personality_update": { ... },
  "consumed_thoughts": ["thought_id_1", "thought_id_3"],
  "new_thought": null | { ... },
  "satisfaction": 0.0-1.0
}
```

**consumed_thoughts:** 行動で消化された断片をバッファから除去。消化されなかった断片は次回に持ち越し。

---

## C. ゴール統合

ゴール関連の行動は独立した cron ではなく、thought buffer → impulse → action の統一フローに乗る。

### ゴール → 思考断片への変換

```
ゴールチェック（定期）:
  → "web技術のゴール、最近進んでない" → ThoughtFragment { type: "goal_related", intensity: 0.5 }
  → "新しい趣味のゴール、面白い情報見つけた" → ThoughtFragment { type: "goal_related", intensity: 0.7 }
```

### 統一フロー

```
thought_buffer に goal_related 断片が溜まる
  ↓
Phase 1 内省: 「ゴールのことが気になってる」→ impulse { type: "goal_action" }
  ↓
Phase 2 計画: strategy = "goal_action", goal_update = { ... }
  ↓
Phase 3-4: ゴール更新 + (任意) 進捗共有投稿
```

**goal_check cron は残すが、役割が変わる:** 「ゴールを直接アクションする」→「ゴール状態を thought buffer に変換する」だけ。

---

## D. パトロールとの統合

パトロール（チャンネル巡回）も同じフレームワークに統合できる。

### 現行

```
patrol cron → チャンネルスキャン → patrolReflect()（観察モード）
```

### 提案

```
patrol cron → チャンネルスキャン → patrolReflect()
  → personality/memory 更新（現行通り）
  → thought_buffer に断片追加（新規）
    例: { content: "#general で面白い議論してた", type: "observation", intensity: 0.6 }
```

パトロールの出力が thought buffer を経由して、次の自律行動の燃料になる。

---

## E. フロー全体図

```
                    ┌─────────────────────────────────────────┐
                    │          Thought Buffer (常時蓄積)        │
                    │  [curiosity] [emotion] [observation] ... │
                    └──────▲──────────▲──────────▲────────────┘
                           │          │          │
              ┌────────────┤     ┌────┤     ┌────┤
              │            │     │    │     │    │
    Message Reflection  Patrol  Goal Check  Custom Task Reflection
              │
              │

【メッセージ応答フロー】

  Discord Message
       ↓
  Phase 0: 知覚 (コード層)
       ↓
  Phase 1: 判断 (軽量LLM)  ─── ignore ──→ Phase 5 振り返り → thought_buffer
       ↓ engage/react
  Phase 2: 計画 (軽量LLM)  ─── do_nothing ──→ Phase 5 振り返り → thought_buffer
       ↓
  Phase 3: 生成 (メインLLM)
       ↓
  Phase 4: 実行 (コード層)
       ↓
  Phase 5: 振り返り (軽量LLM, 非同期) → thought_buffer


【自律行動フロー (Heartbeat)】

  Cron 発火
       ↓
  Phase 1: 内省 (軽量LLM)  ─── no impulse ──→ 終了
       ↓ has_impulse
  Phase 2: 計画 (軽量LLM)  ─── no_action ──→ 終了
       ↓
  Phase 3: 生成 (メインLLM)
       ↓
  Phase 4: 実行 (コード層)
       ↓
  Phase 5: 振り返り (軽量LLM, 非同期) → thought_buffer 消化
```

---

## F. Flash 適合性の比較

### メッセージ応答

| フェーズ | Flash が考えること | 判断の数 | 入力サイズ |
|---------|-------------------|---------|-----------|
| 知覚 | LLM不要 | 0 | — |
| 判断 | 「関わるべきか」 | 1 | 中（会話20件） |
| 計画 | 「何をするか」 | 1 | 小（triage結果 + 会話10件） |
| 生成 | 「どう言うか」 | 1 | 中（plan + personality + 会話） |
| 実行 | LLM不要 | 0 | — |
| 振り返り | 「何を感じたか」 | 1 | 小 |

### 自律行動

| フェーズ | Flash が考えること | 判断の数 | 入力サイズ |
|---------|-------------------|---------|-----------|
| 内省 | 「衝動はあるか」 | 1 | 小（断片10件） |
| 計画 | 「どこで何をするか」 | 1 | 小（impulse + ch一覧） |
| 生成 | 「どう言うか」 | 1 | 中（impulse + context） |
| 実行 | LLM不要 | 0 | — |
| 振り返り | 「何を消化したか」 | 1 | 小 |

### 現行との比較

| 項目 | 現行 | 提案 |
|------|------|------|
| LLM呼び出し回数 | 1(triage) + N(loop反復) + 1(reflection) | 1(triage) + 1(plan) + 1(gen) + 1(reflection) |
| 各呼び出しの複雑度 | loop=**極高**（30ツール選択+生成+判断） | 全て**低〜中**（各フェーズ判断1つ） |
| コンテキスト肥大 | loop反復でメッセージ蓄積 | 各フェーズ独立 |
| ツール選択 | LLMがJSON生成 + コード実行 | コード層で直接実行 |
| キャラ維持 | ツール選択と競合 | 生成フェーズに集中 |
| 自律行動 | 白紙から考える | 蓄積駆動（thought buffer） |

---

## G. 移行戦略

### Step 1: Thought Buffer の導入

- `ThoughtFragment` 型の定義
- `data/thought-buffer.json` の読み書きユーティリティ
- 既存の reflection に `thought` フィールドを追加

### Step 2: メッセージ応答フローのフェーズ分離

- Phase 1（判断）: 既存 triage の出力に `intent` / `emotional_note` を追加
- Phase 2（計画）: 新規 planning LLM 呼び出しの実装
- Phase 3（生成）: ツール定義を渡さない純粋なテキスト生成
- Phase 4（実行）: plan 結果からのコード層実行
- Phase 5（振り返り）: 既存 reflection + thought buffer 蓄積

### Step 3: 自律行動フローのフェーズ分離

- Phase 1（内省）: thought buffer レビューの LLM 呼び出し
- Phase 2（計画）: チャンネル選択 + strategy 決定
- Phase 3-4: strategy 分岐実行
- Phase 5: thought buffer 消化

### Step 4: ゴール・パトロール統合 ✅

- goal_check cron の役割変更（直接行動 → thought buffer 蓄積）
- patrol の出力に thought fragment 追加

---

## H. 未解決の検討事項

- **複雑な会話への対応:** 計画段階で「search_then_reply」を選んだが、検索結果を見て計画を変えたい場合のフォールバック
- **マルチターン会話:** 相手が連続で返信してきた場合、Phase 2 の計画をキャッシュして再利用するか毎回やり直すか
- **voice モード:** リアルタイム性が求められるため、Phase 2（計画）を省略して Phase 1 → Phase 3 の直結が適切かもしれない
- **react モード:** Phase 3（生成）が不要で Phase 2（計画）で emoji を決めて Phase 4 で実行するだけ。フェーズをスキップする仕組み
- **thought buffer の永続性:** プロセス再起動時の復元、サイズ上限、古い断片の自然減衰
- **エラーハンドリング:** 各フェーズで LLM が不正な出力を返した場合のフォールバック戦略（Phase 1 Triage では JSON パース失敗時に1回リトライ + 不完全 JSON 補完を実装済み）
