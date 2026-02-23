import { db } from "../../src/db/index.ts";
import { botActions, messages } from "../../src/db/schema.ts";

/**
 * テスト用にテーブルを作成する。
 * bun:sqlite の :memory: DB は接続ごとに空なので、毎回テーブル定義が必要。
 *
 * 注意: このテーブル定義は src/db/schema.ts および src/db/migrate.ts と
 * 同期を保つ必要がある。スキーマ変更時はここも更新すること。
 */
export function createTestTables(): void {
	db.$client.run(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id TEXT NOT NULL DEFAULT '',
			channel_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			content TEXT NOT NULL,
			is_bot INTEGER DEFAULT 0,
			created_at INTEGER
		)
	`);
	db.$client.run(`
		CREATE TABLE IF NOT EXISTS bot_actions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			channel_id TEXT,
			content TEXT,
			reasoning TEXT,
			triggered_by TEXT,
			created_at INTEGER
		)
	`);
}

/**
 * テーブルの全データを削除する（テスト間のクリーンアップ用）
 */
export function cleanupDb(): void {
	db.delete(messages).run();
	db.delete(botActions).run();
}
