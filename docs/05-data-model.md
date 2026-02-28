# データモデル

## ギルドごとのデータ分離

memory.json / goals.json はギルド（Discord サーバー）ごとに `data/guilds/{guildId}/` に保存され、各サーバーで独立した記憶・ゴールを維持する。personality.json は `data/personality.json` にグローバルで保存され、全ギルドで共有される。

| 項目 | スコープ | 理由 |
|------|---------|------|
| personality.json | グローバル | 全サーバーで共有の人格 |
| global-memory.json | グローバル | 一般知識・夢の洞察（全サーバー共通） |
| memory.json | ギルドごと | サーバーごとに独立した記憶 |
| goals.json | ギルドごと | サーバーごとに独立した目標 |
| channel-categories.json | ギルドごと | サーバーごとに独立したチャンネルカテゴリ設定 |
| heartbeat.json | グローバル | タスクスケジュールはボット全体の設定 |
| avatars/manifest.json | グローバル | アバター画像定義はボット全体の設定 |
| avatar-state.json | グローバル | アバター状態（変更は全サーバー共通） |
| isAgentBusy | ギルドごと | 複数ギルドで同時にエージェント実行可能 |
| message-dedup | guildId をハッシュに含む | ギルド間で同じ発言を許可 |
| DB (messages, bot_actions) | guild_id カラム | ギルド限定クエリに対応 |

**移行**: memory.json / goals.json は `bun run scripts/migrate-to-guild.ts <guildId>` で移行可能（personality.json はグローバルのため移行対象外）。

## グローバルメモリ

サーバーに依存しない一般知識や夢の洞察は `data/global-memory.json` にグローバルメモリとして保存される。ギルドメモリとは独立して管理され、全サーバーのプロンプトに「共通の記憶」セクションとして含まれる。

**保存経路:**
- `save_memory` ツールの `scope: "global"` で bot が明示的に保存
- 蒸留時に LLM が `promote_to_global` で自動分類（一般知識・技術的学び・自己の気づき）
- 夢処理の洞察（`[dream]` タグ付き記憶）は自動的にグローバルメモリに保存

**上限:** 最大50エントリ（`GLOBAL_MAX_ENTRIES`）。超過時はリコールスコアの低いエントリから削除。蒸留タスク実行時に `trimGlobalMemory()` でトリミング。

**プロンプト出力:** 上位15件（`GLOBAL_PROMPT_TOP_ENTRIES`）が「共通の記憶」セクションとして表示。

**移行:** 既存のギルドメモリからグローバルメモリに分類移行するには `bun run scripts/migrate-global-memory.ts <guildId> [--dry-run]` を使用。

## DB テーブル

- `messages` — 全チャンネルの会話ログ (guild_id カラムあり)
- `bot_actions` — bot の行動ログ (action, reasoning, triggeredBy, guild_id)

## 環境変数

`.env.example` 参照。必須: `DISCORD_TOKEN`, `DISCORD_APP_ID`, `GEMINI_API_KEY`
