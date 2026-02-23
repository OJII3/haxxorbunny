import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// テスト用ダミー環境変数（discord.js の Client 初期化を防ぐ）
process.env.DISCORD_TOKEN ??= "test-token-dummy";
process.env.DISCORD_APP_ID ??= "test-app-id-dummy";

// テスト用 DB: インメモリ SQLite
process.env.DB_PATH = ":memory:";

// テスト用データディレクトリ: OS tmpdir 配下に一時ディレクトリを作成
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "haxxorbunny-test-"));
