# アーキテクチャ

## Tool-Use Agent 方式

メイン LLM は OpenAI Function Calling (tools) を使って行動する。JSON レスポンスのパースではなく、LLM がツール（関数）を呼び出すことで Discord を操作する。

**利点:**
- LLM が Discord を人間のように自由に操作できる
- 1ターンで複数アクション実行可能（リアクション + 返信 + メモリ保存 等）
- ツール定義を追加するだけで新機能を拡張可能

## ツール一覧

### Discord ツール

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
| `search_members` | `query`, `limit?` | ユーザー名でメンバー検索（部分一致、最大25件） |
| `list_channels` | (なし) | サーバーのチャンネル一覧 |
| `set_typing` | (なし) | 入力中表示 |
| `do_nothing` | `reasoning` | 何もしない（理由を記録） |

### 記憶・人格ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `save_memory` | `entry`, `emotional_impact?`, `scope?` | 長期記憶に保存（30字以内、感情インパクト1-5、scope: guild/global） |
| `save_user_note` | `username`, `note` | ユーザーメモ保存 |
| `update_personality` | `mood?`, `recent_topics?`, `interests?` | 性格設定更新（mood は4次元ベクトル） |

### ゴール管理ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `set_goal` | `title`, `description`, `priority?` | 新しい目標を設定（最大5つ） |
| `update_goal_progress` | `goal_id`, `note` | 目標の進捗メモを追加 |
| `complete_goal` | `goal_id` | 目標を達成済みにする |
| `list_goals` | (なし) | アクティブな目標一覧 |

### Web検索・取得ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `web_search` | `query` | SearXNG API でWeb検索（上位5件） |
| `fetch_url` | `url` | URLの内容を取得（HTML→テキスト変換、2000字制限） |

### ボイスチャットツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `voice_reply` | `content` | ボイスチャンネルで音声として返答（TTS再生、50文字以内推奨） |
| `leave_voice` | (なし) | ボイスチャンネルから退出する |

### 定期タスク管理ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `list_tasks` | (なし) | 全定期タスク（ビルトイン＋カスタム）の一覧を確認する |
| `update_task` | `task_id`, `enabled?`, `interval_minutes?`, `description?`, `prompt?`, `require_active_hours?` | 定期タスクの設定を変更する。ビルトインタスクの prompt は変更不可 |
| `create_task` | `task_id`, `description`, `prompt`, `interval_minutes` | カスタム定期タスクを作成（最大5個、間隔60〜10080分、プロンプト500字以内） |
| `delete_task` | `task_id` | カスタムタスクを削除する（ビルトインタスクは削除不可） |

### プロフィール画像ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `list_avatars` | (なし) | 使用可能なアバター一覧（ID, 名前, 説明, タグ, 現在のアバター表示）|
| `change_avatar` | `avatar_id`, `reason` | アバター変更（reason 必須で記録。30分クールダウンあり）|
| `get_avatar_status` | (なし) | 現在のアバター + クールダウン残り時間 |

### チャンネルカテゴリツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `list_categories` | (なし) | 全カテゴリ一覧と所属チャンネルを表示 |
| `create_category` | `id`, `name`, `description`, `behavior_description` | カスタムカテゴリを作成（behavior_description は自然言語→LLMパース） |
| `update_category` | `category_id`, `name?`, `description?`, `behavior_description?` | カテゴリの名前・説明・振る舞いを更新（ビルトインも振る舞いのみ更新可） |
| `delete_category` | `category_id` | カスタムカテゴリを削除（ビルトインは不可。所属チャンネルは未分類に戻る） |
| `assign_channel` | `channel_id`, `category_id` | チャンネルをカテゴリに割り当て（既に他カテゴリにあれば移動） |
| `unassign_channel` | `channel_id` | チャンネルをカテゴリから外す（未分類に戻す） |

### AI質問ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `ai_ask` | `question`, `context?` | 高性能AIモデル（Gemini Pro）に質問する（アイデア出し・考察・難問の相談用、コスト高） |

### ログ参照ツール

| ツール名 | パラメータ | 説明 |
|---------|-----------|------|
| `view_messages` | `channel_id?`, `limit?`, `username?`, `keyword?`, `bot_only?` | DB 保存済み会話ログをフィルタ付きで検索（最大50件、content は100文字で truncate） |
| `view_my_actions` | `channel_id?`, `limit?`, `action?`, `triggered_by?` | bot の行動ログ（bot_actions）を検索（最大30件） |
