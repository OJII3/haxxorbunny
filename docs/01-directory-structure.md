# ディレクトリ構成

```
├── biome.json            # Biome linter/formatter 設定
├── compose.yaml          # Podman Compose 設定
├── Containerfile         # コンテナイメージビルド定義
├── drizzle.config.ts     # Drizzle ORM マイグレーション設定
├── flake.nix             # Nix Flake 開発環境定義
├── package.json          # 依存関係 + npm scripts
├── tsconfig.json         # TypeScript コンパイラ設定
moonshine/
├── server.py             # Moonshine ASR FastAPI サーバー (/inference 互換エンドポイント)
├── requirements.txt      # Python 依存関係
└── Containerfile         # コンテナイメージビルド定義
searxng/
└── settings.yml          # SearXNG 検索エンジン設定（JSON フォーマット有効化等）
src/
├── index.ts              # エントリポイント
├── client.ts             # Discord Client (GuildMembers intent 含む)
├── config.ts             # 環境変数
├── data/
│   └── paths.ts          # ギルドごと＋グローバルのデータパスユーティリティ
├── agent/
│   ├── types.ts          # AgentContext, ToolResult, ToolHandler 等の型定義
│   ├── loop.ts           # エージェントループ本体 (MAX_ITERATIONS=5, ギルドごとに busy 管理, streaming + max_tokens:2048)
│   └── tools/
│       ├── index.ts      # ツールレジストリ（定義集約 + 名前→ハンドラ Map）
│       ├── discord.ts    # Discord 操作ツール群
│       ├── memory.ts     # 記憶・人格更新ツール群
│       ├── goals.ts      # ゴール管理ツール群
│       ├── heartbeat.ts  # 定期タスク管理ツール群 (list/update/create/delete)
│       ├── channel-category.ts # チャンネルカテゴリ管理ツール群 (list/create/update/delete/assign/unassign)
│       ├── avatar.ts     # プロフィール画像管理ツール群
│       ├── web.ts        # Web検索・URL取得ツール群
│       ├── voice.ts      # ボイスチャットツール群 (voice_reply, leave_voice)
│       ├── logs.ts       # ログ参照ツール群 (view_messages, view_my_actions)
│       └── thinking.ts   # AI質問ツール群 (ai_ask)
├── utils/
│   ├── time.ts           # JST タイムスタンプフォーマットヘルパー (formatJSTShort, formatJSTFull)
│   └── permissions.ts    # チャンネル権限チェックヘルパー (hasChannelPerms)
├── voice/
│   ├── constants.ts      # サンプルレート、VAD パラメータ等の定数
│   ├── audio-utils.ts    # PCM↔WAV 変換、RMS 音量計算
│   ├── stt.ts            # Moonshine ASR HTTP クライアント (STT)
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
│   ├── thinking-client.ts # Thinking LLM クライアント (ai_ask 用、Gemini Pro)
│   ├── triage.ts         # トリアージ判定ロジック (mood連動の動的3段階方針)
│   ├── triage-throttle.ts # チャンネルごとのスロットリング
│   ├── reflection.ts     # triage後の軽量reflection (人格・記憶更新) + パトロール観察 (patrolReflect)
│   ├── channel-category.ts # チャンネルカテゴリ管理 (カテゴリCRUD・振る舞い判定・旧データ移行)
│   ├── memory.ts         # 記憶管理 (ギルド + グローバル CRUD/toPrompt + 感情スコアリング)
│   ├── memory-filter.ts  # システムプロンプト漏洩フィルタ (isSystemPromptLeak, filterMemoryEntry)
│   ├── goals.ts          # ゴール管理 (CRUD + goalsToPrompt)
│   ├── heartbeat.ts      # 定期タスク管理 + アクティブ時間帯判定
│   ├── distill.ts        # 記憶蒸留 (日次→長期)
│   ├── dream.ts          # 夢処理 (記憶の連想分析・洞察生成)
│   ├── message-buffer.ts # 追いメッセージのデバウンスバッファ (channelId:userId 単位)
│   ├── message-dedup.ts  # メッセージ重複抑制 (SHA-256 + 24時間キャッシュ)
│   ├── avatar.ts         # アバター管理 (マニフェスト読み込み, ステート管理, クールダウン判定)
│   └── prompts/
│       ├── system.ts     # buildSystemPrompt(identity) 関数 (SOUL/TOOLS/IDENTITY_REMINDER 3層構造)
│       └── personality.ts # 可変プロンプト (4次元気分ベクトル + personality.json)
├── scheduler/
│   ├── index.ts          # cron スケジューラー (13分 + 2時間 の2系統)
│   ├── cron.ts           # 高頻度/低頻度タスク分離実行
│   ├── patrol.ts         # チャンネル巡回ロジック (観察モード: patrolReflect 使用、テキスト発言なし)
│   └── goal-check.ts     # ゴールチェック cronタスク
└── db/
    ├── index.ts          # DB 接続
    ├── schema.ts         # Drizzle スキーマ
    ├── migrate.ts        # テーブル作成
    └── queries.ts        # クエリヘルパー
data/
├── heartbeat.json        # HEARTBEAT: グローバル定期タスク設定 (type: builtin/custom, prompt, require_active_hours)
├── personality.json      # PERSONALITY: グローバル人格設定 (bot が自己更新可能、全ギルド共有)
├── global-memory.json    # GLOBAL MEMORY: 全サーバー共通の記憶 (一般知識・夢の洞察)
├── memory.json           # レガシー (同上)
├── goals.json            # レガシー (同上)
├── guilds/               # ギルドごとのデータ (移行後に自動作成)
│   └── {guildId}/
│       ├── memory.json       # MEMORY: 長期記憶 (bot が自動更新)
│       ├── goals.json        # GOALS: ゴール管理 (bot が自己更新可能)
│       ├── channel-categories.json # CHANNEL CATEGORIES: チャンネルカテゴリ設定 (bot が自己更新可能)
│       └── memory/           # 日次記憶蒸留
│           └── YYYY-MM-DD.json
├── avatars/              # アバター画像 + メタデータ
│   └── manifest.json     # アバター定義（ID, ファイル名, 名前, 説明, タグ）
├── avatar-state.json     # アバター状態（実行時生成, gitignore）
├── haxxorbunny.db        # SQLite DB (gitignore)
scripts/
├── migrate-to-guild.ts       # 既存データ移行スクリプト
├── migrate-global-memory.ts  # ギルド記憶→グローバル記憶の分類移行スクリプト
└── sanitize-memory.ts        # システムプロンプト漏洩記憶のサニタイズスクリプト (--dry-run 対応)
```
