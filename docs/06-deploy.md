# デプロイ（Podman Compose / ローカル）

## 前提条件

- `podman` & `podman-compose` がインストール済み
- `.env` ファイルがプロジェクトルートに存在（`.env.example` を参照して作成）
- Google AI Studio の API キー（`GEMINI_API_KEY`）を `.env` に設定
- Discord Developer Portal で `GuildMembers` Privileged Intent を有効化
- ボイスチャット使用時: VOICEVOX Engine と Moonshine ASR サーバーが起動済み（compose.yaml で自動起動）

## デプロイコマンド

```bash
# 起動（ビルド込み・バックグラウンド）
podman-compose up --build -d

# 停止
podman-compose down

# 再デプロイ（停止→ビルド→起動）
podman-compose down && podman-compose up --build -d

# ログ確認
podman logs haxxorbunny          # bot

# ステータス確認
podman-compose ps
```

## サービス構成

| サービス | コンテナ名 | 説明 |
|---------|-----------|------|
| bot | haxxorbunny | Discord bot 本体 (Bun) |
| searxng | haxxorbunny-searxng | Web検索エンジン (SearXNG) |
| voicevox | haxxorbunny-voicevox | TTS Engine (VOICEVOX, CPU) |
| moonshine | haxxorbunny-moonshine | STT Server (Moonshine ASR, moonshine-tiny-ja) |

## データ永続化

- `bot-data` ボリューム → `/app/data`（SQLite DB, heartbeat.json, guilds/{guildId}/personality.json, memory.json, goals.json, memory/）
