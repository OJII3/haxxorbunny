/**
 * 既存データをギルドごとのディレクトリに移行するスクリプト
 *
 * 使い方:
 *   bun run scripts/migrate-to-guild.ts <guildId>
 *
 * 動作:
 *   1. data/personality.json → data/guilds/{guildId}/personality.json にコピー
 *   2. data/memory.json → data/guilds/{guildId}/memory.json にコピー
 *   3. data/goals.json → data/guilds/{guildId}/goals.json にコピー
 *   4. data/memory/*.json → data/guilds/{guildId}/memory/ にコピー
 *   5. DB: UPDATE messages SET guild_id = ? WHERE guild_id = ''
 *   6. DB: UPDATE bot_actions SET guild_id = ? WHERE guild_id = ''
 *   7. 元ファイルを data/_backup/ に移動
 */

import { Database } from "bun:sqlite";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
} from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dir, "../data");
const DB_PATH = join(DATA_DIR, "haxxorbunny.db");

const guildId = process.argv[2];
if (!guildId) {
	console.error("Usage: bun run scripts/migrate-to-guild.ts <guildId>");
	process.exit(1);
}

console.log(`[migrate] Migrating data for guild: ${guildId}`);

// ターゲットディレクトリ作成
const guildDir = join(DATA_DIR, "guilds", guildId);
const guildMemoryDir = join(guildDir, "memory");
mkdirSync(guildDir, { recursive: true });
mkdirSync(guildMemoryDir, { recursive: true });

// バックアップディレクトリ作成
const backupDir = join(DATA_DIR, "_backup");
mkdirSync(backupDir, { recursive: true });
const backupMemoryDir = join(backupDir, "memory");

// 1. personality.json
const personalityPath = join(DATA_DIR, "personality.json");
if (existsSync(personalityPath)) {
	const dest = join(guildDir, "personality.json");
	if (!existsSync(dest)) {
		copyFileSync(personalityPath, dest);
		console.log(`[migrate] Copied personality.json → guilds/${guildId}/`);
	} else {
		console.log(
			`[migrate] Skipped personality.json (already exists in guild dir)`,
		);
	}
} else {
	console.log("[migrate] personality.json not found, skipping");
}

// 2. memory.json
const memoryPath = join(DATA_DIR, "memory.json");
if (existsSync(memoryPath)) {
	const dest = join(guildDir, "memory.json");
	if (!existsSync(dest)) {
		copyFileSync(memoryPath, dest);
		console.log(`[migrate] Copied memory.json → guilds/${guildId}/`);
	} else {
		console.log(`[migrate] Skipped memory.json (already exists in guild dir)`);
	}
} else {
	console.log("[migrate] memory.json not found, skipping");
}

// 3. goals.json
const goalsPath = join(DATA_DIR, "goals.json");
if (existsSync(goalsPath)) {
	const dest = join(guildDir, "goals.json");
	if (!existsSync(dest)) {
		copyFileSync(goalsPath, dest);
		console.log(`[migrate] Copied goals.json → guilds/${guildId}/`);
	} else {
		console.log(`[migrate] Skipped goals.json (already exists in guild dir)`);
	}
} else {
	console.log("[migrate] goals.json not found, skipping");
}

// 4. data/memory/*.json → data/guilds/{guildId}/memory/
const dailyMemoryDir = join(DATA_DIR, "memory");
if (existsSync(dailyMemoryDir)) {
	const files = readdirSync(dailyMemoryDir).filter((f) => f.endsWith(".json"));
	let copied = 0;
	for (const file of files) {
		const dest = join(guildMemoryDir, file);
		if (!existsSync(dest)) {
			copyFileSync(join(dailyMemoryDir, file), dest);
			copied++;
		}
	}
	console.log(
		`[migrate] Copied ${copied}/${files.length} daily memory files → guilds/${guildId}/memory/`,
	);
} else {
	console.log("[migrate] data/memory/ not found, skipping");
}

// 5. DB: guild_id を更新
if (existsSync(DB_PATH)) {
	const sqlite = new Database(DB_PATH);

	const msgResult = sqlite.run(
		`UPDATE messages SET guild_id = ? WHERE guild_id = ''`,
		[guildId],
	);
	console.log(
		`[migrate] Updated ${msgResult.changes} messages with guild_id=${guildId}`,
	);

	const actionResult = sqlite.run(
		`UPDATE bot_actions SET guild_id = ? WHERE guild_id = ''`,
		[guildId],
	);
	console.log(
		`[migrate] Updated ${actionResult.changes} bot_actions with guild_id=${guildId}`,
	);

	sqlite.close();
} else {
	console.log("[migrate] Database not found, skipping DB migration");
}

// 6. 元ファイルをバックアップに移動
if (existsSync(personalityPath)) {
	renameSync(personalityPath, join(backupDir, "personality.json"));
	console.log("[migrate] Moved personality.json → _backup/");
}
if (existsSync(memoryPath)) {
	renameSync(memoryPath, join(backupDir, "memory.json"));
	console.log("[migrate] Moved memory.json → _backup/");
}
if (existsSync(goalsPath)) {
	renameSync(goalsPath, join(backupDir, "goals.json"));
	console.log("[migrate] Moved goals.json → _backup/");
}
if (existsSync(dailyMemoryDir)) {
	mkdirSync(backupMemoryDir, { recursive: true });
	const files = readdirSync(dailyMemoryDir).filter((f) => f.endsWith(".json"));
	for (const file of files) {
		renameSync(join(dailyMemoryDir, file), join(backupMemoryDir, file));
	}
	console.log(`[migrate] Moved ${files.length} daily files → _backup/memory/`);
}

console.log("[migrate] Migration complete!");
