# haxxorbunny

Discord に住む自律的エージェント bot。LLM (aiclient-2-api 経由 Gemini) を使って自律的に行動する。

## 技術スタック

- Runtime: Bun
- 言語: TypeScript (strict)
- Discord: discord.js v14
- LLM: OpenAI SDK → aiclient-2-api (OpenAI 互換エンドポイント)
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
- `bun test` — テスト実行

## ディレクトリ構成

```
src/
├── index.ts              # エントリポイント
├── client.ts             # Discord Client
├── config.ts             # 環境変数
├── discord/
│   ├── events/           # messageCreate, ready, messageReactionAdd
│   └── register.ts       # イベント登録
├── llm/
│   ├── client.ts         # OpenAI SDK ラッパー
│   ├── chat.ts           # LLM チャット呼び出し
│   └── prompts/
│       ├── system.ts     # 不変システムプロンプト
│       └── personality.ts # 可変プロンプト (personality.json)
├── scheduler/
│   ├── index.ts          # cron スケジューラー
│   └── cron.ts           # 自主発言ロジック
└── db/
    ├── index.ts          # DB 接続
    ├── schema.ts         # Drizzle スキーマ
    ├── migrate.ts        # テーブル作成
    └── queries.ts        # クエリヘルパー
data/
├── personality.json      # 可変プロンプト (bot が自己更新可能)
└── haxxorbunny.db        # SQLite DB (gitignore)
```

## アーキテクチャ

### LLM レスポンス形式

LLM は必ず以下の JSON を返す:

```json
{
  "action": "message" | "reaction" | "none",
  "content": "メッセージ内容",
  "emoji": "リアクション絵文字",
  "personality_update": null | { ...部分更新 },
  "reasoning": "行動の理由（内部ログ用）"
}
```

### イベントフロー

1. **メッセージ受信** → DB 保存 → 応答判定 (メンション/名前含む) → LLM → Discord 送信
2. **自主発言** → 30分ごとに cron → LLM に問い合わせ → 投稿 or スキップ
3. **ランダムリアクション** → 応答対象外メッセージに 5% の確率でリアクション

### DB テーブル

- `messages` — 全チャンネルの会話ログ
- `bot_actions` — bot の行動ログ (action, reasoning, triggeredBy)

## 環境変数

`.env.example` 参照。必須: `DISCORD_TOKEN`, `DISCORD_APP_ID`

## コーディング規約

- Formatter: Biome (tab インデント)
- import 順序: Biome の organizeImports に従う
- コード変更後は必ず `nr typecheck && nr lint` で確認
- 適宜コミットし、PRを作成すること
- 作業完了時は自動的に push して PR を作成すること（`/create-pr` スキルを使用）
- CLAUDE.md はプロジェクトのドキュメントとして常に最新に保つこと
