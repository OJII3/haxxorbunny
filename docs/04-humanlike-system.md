# 人間らしさシステム

## アクティブ時間帯

8時〜翌2時（JST）のみ自主発言・チャンネル巡回。深夜は活動休止。

## 重複発言抑制

SHA-256 + 冒頭50文字ハッシュで24時間キャッシュ。cron トリガー時のみチェック。

## 4次元気分ベクトル

energy/positivity/sociability/curiosity (各0-1)。時間帯で energy 自動変動、急変防止の補間（70% new + 30% old）。

## 感情付き記憶

MemoryEntry に emotional_impact (1-5) + created_at。エビングハウス忘却曲線（30日半減期）でスコアリング。

## 夢処理

24時間ごとにサーバー記憶+グローバル記憶を連想分析。洞察を [dream] タグ付きグローバル記憶として追加、不要なサーバー記憶を整理。

## buildSystemPrompt(identity)

`BotIdentity`（botUserId, botUsername, displayName）を受け取り、bot 自身の情報を注入した SYSTEM_PROMPT を毎回生成。

## メッセージデバウンス

同一 channelId:userId の連続メッセージを3秒（`MESSAGE_BUFFER_MS`）蓄積。最大15秒（`MESSAGE_BUFFER_MAX_MS`）で強制フラッシュ。結合コンテンツとしてトリアージに渡す。

## 自動 typing インジケーター

エージェントループ中は5秒間隔で sendTyping() を呼び、Discord 上に「入力中…」を表示。

## ゴール駆動行動

bot が自分で目標を設定し、cron で定期的に進捗確認・アクション実行。

## チャンネル巡回（観察モード）

bot が不在のチャンネルを定期的にスキャン（上位3チャンネル）。`patrolReflect()` で会話を観察し、interests/topics/mood の微調整・記憶保存・リアクション（最大2件）のみ実行。テキスト発言は一切しない。

## チャンネルカテゴリシステム

チャンネルの役割をカテゴリで分類し、カテゴリごとに振る舞いを定義する統合管理システム。`list_categories` / `create_category` / `update_category` / `delete_category` / `assign_channel` / `unassign_channel` の6ツールで管理。プリセットカテゴリ: `my-space`（自分の居場所、avg_offset=+0.5、自発的発言OK）、`observe-only`（観察のみ、avg_offset=-0.8、リアクションのみ）、`bot-chat`（bot会話、avg_offset=+0.3、respond_to_bots=true）。未分類チャンネルでは全行動を控える（メンション時のみ反応）。カスタムカテゴリは最大5個、自然言語で振る舞いを記述すると triageLlm がパラメータ化。旧データ（home-channels.json→my-space、channel-policies.json→カスタムカテゴリ）からの自動移行対応。

## bot同士の会話

bot-chat カテゴリに設定されたチャンネルでは、他 bot のメッセージにも人間と同じように反応。無限ループ防止として直近3件が連続 bot 発言の場合はスキップ（BOT_CHAIN_LIMIT=3）。会話履歴では自分のメッセージのみ assistant ロール、他 bot は user ロール。

## メンション記憶強化

メンション（直接の呼びかけ）による指示・依頼は忘れにくくする。AgentContext に `isMentioned` を伝播し、①システムプロンプトで save_memory を促す、②emotional_impact の最低値を 3 にフロアリング。30日後のスコアが impact=2 の ~0.425 → impact=3 の ~0.500 以上に改善。

## 自律的タスク管理

bot が `list_tasks` / `update_task` / `create_task` / `delete_task` ツールで全定期タスクを自律的に管理可能。ビルトインタスク（autonomous_post, channel_patrol, goal_check, distill_memory, cleanup_old_memory, dream_processing）の有効/無効・間隔を変更でき、さらにカスタム定期タスク（最大5個）を自由に作成・編集・削除できる。カスタムタスクは指定したプロンプトに従ってエージェントループを定期実行する。HeartbeatTask に `type`（builtin/custom）、`prompt`（カスタムタスクの実行プロンプト）、`require_active_hours`（アクティブ時間帯限定、デフォルトtrue）フィールドを追加。

## 自律的プロフィール画像変更

bot が `list_avatars` / `change_avatar` / `get_avatar_status` ツールでプロフィール画像を自律的に変更可能。30分のクールダウンで頻繁な変更を防止。変更履歴（直近20件）を記録。画像は `data/avatars/` に配置し `manifest.json` で管理。

## LLM ストリーミング応答

エージェントループの LLM 呼び出しは `stream: true` + `max_tokens: 2048` で動作。チャンクから content と tool_calls を index ベースで蓄積・組み立て。ストリームエラー・空レスポンス・max_tokens 途中切れのガード付き。

## 連結 JSON 展開

LLM が tool_call の arguments に複数の JSON オブジェクトを連結して返すケース（`{...}{...}`）に対応。`parseAllJsonObjects` が全オブジェクトを抽出し、`inferToolNameFromArgs` が各オブジェクトの引数キーからツール定義をスコアリングしてツール名を推定。エージェントループで個別の tool_call として展開・実行する。`parseToolArguments` は安全弁として先頭オブジェクトのみ返すフォールバックを維持。

## メンション禁止（多層防御）

bot が他のユーザーを `<@userId>` 形式でメンションしないよう、プロンプト（SYSTEM_PROMPT）で指示 + コードレベルで `allowedMentions: { parse: [] }` を全メッセージ送信（send/reply/edit）に適用。LLM がプロンプトを無視した場合でも Discord API レベルでメンションが無効化される。

## 画像読み取り

メッセージに添付された画像（png/jpeg/gif/webp）を OpenAI SDK の `content` 配列形式（`text` + `image_url` パーツ）で LLM に渡す。1メッセージ最大4枚、`detail: "low"` でトークン節約。DB には `[画像: filename]` としてテキスト追記。トリアージ LLM には画像を渡さず、テキストで画像がある旨を伝える。

## システムプロンプト漏洩フィルタ（多層防御）

システムプロンプトの内部指示・設定が記憶に保存されないよう、多層で防御。①プロンプト層（SYSTEM_PROMPT + 蒸留/夢/リフレクション各プロンプト）で指示、②コード層（`memory-filter.ts` の `isSystemPromptLeak` 関数）で `save_memory` ツール・`appendMemoryEntry`・`appendGlobalMemoryEntry`・`processMemoryFields` の全入口をフィルタリング。「AI の話題で盛り上がった」等の一般的な話題言及は許可し、システムプロンプト内部用語（Core Truths, IDENTITY_REMINDER, buildSystemPrompt 等）を含むパターンのみブロック。ブロック時は silent に成功を返し LLM の再試行を防止。既存データの一括サニタイズは `bun run scripts/sanitize-memory.ts [--dry-run]`。

## AIアシスタント的振る舞い禁止

「何かお手伝いできますか？」等のカスタマーサポート的対応をプロンプト（SYSTEM_PROMPT）で禁止。サービス提供者ではなくキャラクターとして会話する。

## キャラクターとしてのセリフ生成

「人間のフリ」ではなく「自律型 bot がキャラクターとして行動」する方式。bot であることを隠す必要はないがキャラを崩さない。頭を使わないゆるい会話、緩い相槌（「うへー」「うおー」等）、特に内容のない発言、くだらないダジャレ（スベる）を積極的に行う。困りごとを聞いたり、何かを教えてあげたりする行為はキャラに反するため禁止。自分自身を三人称で呼ばない（「世界の泡の住人さん」等は禁止）。

## SYSTEM_PROMPT 3層構造（SOUL/TOOLS/IDENTITY_REMINDER）

OpenClaw の SOUL/TOOLS 分離 + Project Airi のサンドイッチパターンを適用。`buildSystemPrompt(identity)` 関数で `BotIdentity`（Discord ID・ユーザー名・表示名）を注入して生成。SOUL（先頭）でアイデンティティの核（Core Truths, 発言例, フォーマット制約, 三人称禁止）を定義、TOOLS（中間）でツール説明・記憶・気分・チャンネルカテゴリ等の機能情報のみを記載、IDENTITY_REMINDER（末尾）で短いリマインダー（「丁寧にならない。三人称で自分を呼ばない。」）を配置しアテンションを再びアイデンティティに向ける。

## stripMarkdown によるマークダウン除去（多層防御）

memory-filter.ts と同じ多層防御パターン。プロンプト（第1層）でマークダウン装飾を禁止し、コード層（第2層）で `stripMarkdown()` 関数が `send_message` / `reply_to_message` / `edit_message` の全送信で太字・見出し・コードブロック・箇条書き等を除去。顔文字の `*` や URL 内の `#` は保持。

## メッセージ長ソフトキャップ

200文字超のメッセージ送信時にツール結果に警告文を含める（メッセージ自体は送信する）。LLM の次ターンで参照され、行動修正を促す。

## depth injection（Mid-Conversation Identity Reminder）

SillyTavern の depth injection パターンを適用。会話メッセージが6件以上ある場合、最新4メッセージ手前に短い system メッセージ（「あなたは「世界の泡の住人」というキャラ。短く雑に。1〜2文。丁寧にならない。三人称で自分を呼ばない。」）を挿入し、長い会話コンテキストでのアイデンティティ喪失を防止。
