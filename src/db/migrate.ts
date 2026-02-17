import { Database } from "bun:sqlite";
import { join } from "node:path";

const DB_PATH = join(import.meta.dir, "../../data/haxxorbunny.db");

export function runMigrations() {
	const sqlite = new Database(DB_PATH, { create: true });

	sqlite.run(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			channel_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			content TEXT NOT NULL,
			is_bot INTEGER DEFAULT 0,
			created_at INTEGER
		)
	`);

	sqlite.run(`
		CREATE TABLE IF NOT EXISTS bot_actions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			action TEXT NOT NULL,
			channel_id TEXT,
			content TEXT,
			reasoning TEXT,
			triggered_by TEXT,
			created_at INTEGER
		)
	`);

	sqlite.close();
	console.log("[db] Migrations complete");
}
