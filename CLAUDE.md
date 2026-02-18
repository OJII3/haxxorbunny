# haxxorbunny

Discord に住む自律的エージェント bot。LLM (aiclient-2-api 経由 Gemini) を使い、Tool-Use（関数呼び出し）方式で自律的に行動する。

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
├── client.ts             # Discord Client (GuildMembers intent 含む)
├── config.ts             # 環境変数
├── agent/
│   ├── types.ts          # AgentContext, ToolResult, ToolHandler 等の型定義
│   ├── loop.ts           # エージェントループ本体
│   └── tools/
│       ├── index.ts      # ツールレジストリ（定義集約 + 名前→ハンドラ Map）
│       ├── discord.ts    # Discord 操作ツール群
│       └── memory.ts     # 記憶・人格更新ツール群
├── discord/
│   ├── events/           # messageCreate, ready, messageReactionAdd
│   └── register.ts       # イベント登録
├── llm/
│   ├── client.ts         # メイン LLM OpenAI SDK ラッパー
│   ├── triage-client.ts  # トリアージ LLM 専用クライアント
│   ├── triage.ts         # トリアージ判定ロジック (ignore/engage 2択)
│   ├── triage-throttle.ts # チャンネルごとのスロットリング
│   ├── reflection.ts     # triage後の軽量reflection (人格・記憶更新)
│   ├── memory.ts         # 記憶管理 (load/save/append/toPrompt)
│   ├── heartbeat.ts      # 定期タスク管理
│   ├── distill.ts        # 記憶蒸留 (日次→長期)
│   └── prompts/
│       ├── system.ts     # 不変システムプロンプト (ツールベース)
│       └── personality.ts # 可変プロンプト (personality.json)
├── scheduler/
│   ├── index.ts          # cron スケジューラー
│   └── cron.ts           # heartbeatタスク統合 (自主発言・蒸留・整理)
└── db/
    ├── index.ts          # DB 接続
    ├── schema.ts         # Drizzle スキーマ
    ├── migrate.ts        # テーブル作成
    └── queries.ts        # クエリヘルパー
data/
├── personality.json      # SOUL: 可変プロンプト (bot が自己更新可能)
├── memory.json           # MEMORY: 長期記憶 (bot が自動更新)
├── heartbeat.json        # HEARTBEAT: 定期タスク設定
├── memory/               # 日次記憶蒸留 (gitignore)
│   └── YYYY-MM-DD.json
└── haxxorbunny.db        # SQLite DB (gitignore)
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
| `save_memory` | `entry` | 長期記憶に保存（30字以内） |
| `save_user_note` | `username`, `note` | ユーザーメモ保存 |
| `update_personality` | `mood?`, `recent_topics?`, `interests?` | 性格設定更新 |

### トリアージ LLM レスポンス形式

トリアージ LLM（高速モデル）は以下の JSON を返す:

```json
{
  "action": "ignore" | "engage",
  "reasoning": "判定理由",
  "confidence": 0.0〜1.0
}
```

### イベントフロー（エージェントループ）

```
メッセージ受信 → DB保存 → Bot除外 → スロットル判定(*) → トリアージLLM(高速) → 判定
                                    (* メンション時はスロットルをバイパス)
  トリアージ結果:
  ├─ ignore:  reflection LLM(flash, fire-and-forget) → personality + memory 更新
  └─ engage:  エージェントループ起動
       ├─ LLM に tools 定義 + SOUL + MEMORY + 会話履歴を送信
       ├─ tool_calls → 各ツール実行 → 結果を LLM に返す → ループ
       └─ finish_reason=stop → 終了（最大5イテレーション）

cron (10分) → heartbeat タスクチェック
  ├─ autonomous_post (10分): エージェントループ → 自主発言 + personality + memory 更新
  ├─ distill_memory (6時間): 蒸留LLM(flash) → 日次記憶集約 + 長期記憶更新
  └─ cleanup_old_memory (24時間): 古い日次ファイルの整理
```

- メンションかどうかに関わらず、全メッセージがトリアージを通る統一フロー
- メンション情報はトリアージのコンテキストとして渡され、判断材料として使われる
- トリアージは控えめ方針。以下の場合のみ engage: メンション、会話の混乱整理、誤解防止、直接の質問
- ignore 時は reflection LLM が人格・記憶を更新（fire-and-forget）
- engage 時はエージェントループが起動し、LLM がツールで自由に行動

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
- Discord Developer Portal で `GuildMembers` Privileged Intent を有効化

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

- `bot-data` ボリューム → `/app/data`（SQLite DB, personality.json, memory.json, heartbeat.json, memory/）
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
