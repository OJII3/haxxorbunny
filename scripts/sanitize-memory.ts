// 既存の memory.json / global-memory.json をスキャンして
// AI/bot 自覚エントリを除去するサニタイズスクリプト
//
// 使い方:
//   bun run scripts/sanitize-memory.ts [--dry-run]
//
// 動作:
//   1. data/global-memory.json をスキャン
//   2. data/guilds/{guildId}/memory.json を全てスキャン
//   3. isAISelfAwareness に一致するエントリを除去
//   4. --dry-run を付けると検出結果を表示するだけで書き込みしない

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GlobalMemory, Memory, MemoryEntry } from "../src/llm/memory.ts";
import { normalizeEntry } from "../src/llm/memory.ts";
import { isAISelfAwareness } from "../src/llm/memory-filter.ts";

const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dir, "../data");
const dryRun = process.argv.includes("--dry-run");

console.log(`[sanitize] Data dir: ${DATA_DIR}`);
console.log(`[sanitize] Dry run: ${dryRun}`);
console.log();

let totalRemoved = 0;

// 1. グローバルメモリのスキャン
const globalPath = join(DATA_DIR, "global-memory.json");
if (existsSync(globalPath)) {
	const globalMemory = JSON.parse(
		readFileSync(globalPath, "utf-8"),
	) as GlobalMemory;
	const before = globalMemory.entries.length;
	const blocked: string[] = [];

	globalMemory.entries = globalMemory.entries.filter((entry) => {
		const text = typeof entry === "string" ? entry : entry.text;
		if (isAISelfAwareness(text)) {
			blocked.push(text);
			return false;
		}
		return true;
	});

	if (blocked.length > 0) {
		console.log(
			`[sanitize] global-memory.json: ${blocked.length} entries to remove (${before} -> ${globalMemory.entries.length})`,
		);
		for (const text of blocked) {
			console.log(`  - ${text}`);
		}
		totalRemoved += blocked.length;

		if (!dryRun) {
			globalMemory.last_updated = new Date().toISOString();
			writeFileSync(
				globalPath,
				JSON.stringify(globalMemory, null, "\t"),
				"utf-8",
			);
			console.log("  -> Written");
		}
	} else {
		console.log("[sanitize] global-memory.json: clean");
	}
} else {
	console.log("[sanitize] global-memory.json: not found, skipping");
}

console.log();

// 2. ギルドメモリのスキャン
const guildsDir = join(DATA_DIR, "guilds");
if (existsSync(guildsDir)) {
	const guildIds = readdirSync(guildsDir);
	for (const guildId of guildIds) {
		const memoryPath = join(guildsDir, guildId, "memory.json");
		if (!existsSync(memoryPath)) continue;

		const memory = JSON.parse(readFileSync(memoryPath, "utf-8")) as Memory;
		const before = memory.entries.length;
		const blocked: string[] = [];

		memory.entries = memory.entries.filter((entry: string | MemoryEntry) => {
			const normalized = normalizeEntry(entry);
			if (isAISelfAwareness(normalized.text)) {
				blocked.push(normalized.text);
				return false;
			}
			return true;
		});

		if (blocked.length > 0) {
			console.log(
				`[sanitize] guilds/${guildId}/memory.json: ${blocked.length} entries to remove (${before} -> ${memory.entries.length})`,
			);
			for (const text of blocked) {
				console.log(`  - ${text}`);
			}
			totalRemoved += blocked.length;

			if (!dryRun) {
				memory.last_updated = new Date().toISOString();
				writeFileSync(memoryPath, JSON.stringify(memory, null, "\t"), "utf-8");
				console.log("  -> Written");
			}
		} else {
			console.log(`[sanitize] guilds/${guildId}/memory.json: clean`);
		}
	}
} else {
	console.log("[sanitize] guilds/ directory not found, skipping");
}

console.log();
console.log(
	`[sanitize] Total: ${totalRemoved} entries ${dryRun ? "would be removed" : "removed"}`,
);
