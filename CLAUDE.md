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
│   ├── client.ts         # メイン LLM OpenAI SDK ラッパー
│   ├── triage-client.ts  # トリアージ LLM 専用クライアント
│   ├── chat.ts           # メイン LLM チャット呼び出し
│   ├── triage.ts         # トリアージ判定ロジック + プロンプト
│   ├── triage-throttle.ts # チャンネルごとのスロットリング
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

メイン LLM は必ず以下の JSON を返す:

```json
{
  "action": "message" | "reply" | "reaction" | "none",
  "content": "メッセージ内容 (message/reply)",
  "emoji": "リアクション絵文字 (reaction)",
  "personality_update": null | { ...部分更新 },
  "reasoning": "行動の理由（内部ログ用）"
}
```

### トリアージ LLM レスポンス形式

トリアージ LLM（高速モデル）は以下の JSON を返す:

```json
{
  "action": "ignore" | "reaction" | "reply" | "message",
  "emoji": "リアクション絵文字 (reaction の場合)",
  "reasoning": "判定理由",
  "confidence": 0.0〜1.0
}
```

### イベントフロー（統一パイプライン）

```
メッセージ受信 → DB保存 → Bot除外 → スロットル判定(*) → トリアージLLM(高速) → 判定
                                    (* メンション時はスロットルをバイパス)
  トリアージ結果:
  ├─ ignore: 何もしない
  ├─ reaction: トリアージが絵文字選択（メインLLM不要）
  ├─ reply: メインLLM → message.reply()
  └─ message: メインLLM → channel.send()
```

- メンションかどうかに関わらず、全メッセージがトリアージを通る統一フロー
- メンション情報はトリアージのコンテキストとして渡され、判断材料として使われる
- トリアージは「この会話に混ざりたいか」を基準に判定する

1. **メッセージ受信** → DB 保存 → スロットル判定 → トリアージ LLM（メンション情報含む） → アクション実行
2. **自主発言** → 30分ごとに cron → メイン LLM に問い合わせ → 投稿 or スキップ

### DB テーブル

- `messages` — 全チャンネルの会話ログ
- `bot_actions` — bot の行動ログ (action, reasoning, triggeredBy)

## 環境変数

`.env.example` 参照。必須: `DISCORD_TOKEN`, `DISCORD_APP_ID`

## デプロイ（Podman Compose / ローカル）

### 前提条件

- `podman` & `podman-compose` がインストール済み
- `.env` ファイルがプロジェクトルートに存在（`.env.example` を参照して作成）
- `~/.gemini/` に Gemini 認証情報（`oauth_creds.json` 等）が存在

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

### データ永続化

- `bot-data` ボリューム → `/app/data`（SQLite DB, personality.json）
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
