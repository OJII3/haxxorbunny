# haxxorbunny

Discord に住む自律的エージェント bot。LLM (Gemini API OpenAI 互換エンドポイント) を使い、Tool-Use（関数呼び出し）方式で自律的に行動する。

Main branch: `main`

## 技術スタック

- Runtime: Bun
- 言語: TypeScript (strict)
- Discord: discord.js v14
- LLM: OpenAI SDK → Gemini API (OpenAI 互換エンドポイント直接呼び出し)
- Voice: @discordjs/voice + opusscript (純JS Opus)
- STT: Moonshine ASR サーバー (UsefulSensors/moonshine-tiny-ja, Docker)
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

## ドキュメント

詳細な技術ドキュメントは `docs/` ディレクトリを参照:

| ファイル | 内容 |
|---------|------|
| [docs/01-directory-structure.md](docs/01-directory-structure.md) | ディレクトリ構成 |
| [docs/02-architecture.md](docs/02-architecture.md) | Tool-Use Agent 方式 + ツール一覧 |
| [docs/03-event-flow.md](docs/03-event-flow.md) | トリアージ + イベントフロー + コンテキスト対応 |
| [docs/04-humanlike-system.md](docs/04-humanlike-system.md) | 人間らしさシステム全般 |
| [docs/05-data-model.md](docs/05-data-model.md) | ギルドごとのデータ分離 + グローバルメモリ + DB + 環境変数 |
| [docs/06-deploy.md](docs/06-deploy.md) | デプロイ手順 |
| [docs/07-phased-architecture.md](docs/07-phased-architecture.md) | フェーズ分離型アーキテクチャ設計書 |
| [docs/TODO.md](docs/TODO.md) | 今後の作業項目・改善案 |

## コーディング規約

- Formatter: Biome (tab インデント)
- import 順序: Biome の organizeImports に従う
- コード変更後は必ず `nr typecheck && nr lint` で確認
- コード変更後はユーザーに言われる前に自発的に commit → push → PR 作成まで一連で行うこと
  - commit: 変更をこまめにコミット
  - push: コミット後は必ず push
  - PR 作成: 作業ブランチなら `/create-pr` スキルで PR を作成
- CLAUDE.md および docs/ 内のドキュメントはプロジェクトのドキュメントとして常に最新に保つこと
- ユーザーが「merge」と言った場合、該当 PR をマージし、最新の main ブランチに戻ること（`gh pr merge` → `git checkout main && git pull`）
