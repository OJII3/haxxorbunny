/**
 * ギルドの記憶からグローバル記憶に昇格すべきエントリを分類する移行スクリプト
 *
 * 使い方:
 *   bun run scripts/migrate-global-memory.ts <guildId> [--dry-run]
 *
 * 動作:
 *   1. 指定ギルドの memory.json を読み込み
 *   2. LLM (triage) で各エントリを global/guild に分類
 *   3. global 判定のエントリを data/global-memory.json に追加
 *   4. 元のギルドメモリからは削除しない（安全のため）
 *
 * --dry-run を付けると分類結果を表示するだけで書き込みしない
 */

import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { globalMemoryPath, guildMemoryPath } from "../src/data/paths.ts";
import {
	type GlobalMemory,
	type Memory,
	type MemoryEntry,
	normalizeEntry,
} from "../src/llm/memory.ts";

const guildId = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!guildId) {
	console.error(
		"Usage: bun run scripts/migrate-global-memory.ts <guildId> [--dry-run]",
	);
	process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
	console.error("GEMINI_API_KEY environment variable is required");
	process.exit(1);
}

const baseUrl =
	process.env.TRIAGE_API_BASE_URL ??
	process.env.LLM_API_BASE_URL ??
	"https://generativelanguage.googleapis.com/v1beta/openai/";
const model = process.env.TRIAGE_MODEL ?? "gemini-2.5-flash";

const llm = new OpenAI({ baseURL: baseUrl, apiKey });

interface ClassifyResult {
	classifications: Array<{
		index: number;
		scope: "guild" | "global";
		reason: string;
	}>;
}

// ギルドメモリ読み込み
const memoryPath = guildMemoryPath(guildId);
let memory: Memory;
try {
	memory = JSON.parse(readFileSync(memoryPath, "utf-8")) as Memory;
} catch {
	console.error(`[migrate] Could not read ${memoryPath}`);
	process.exit(1);
}

if (memory.entries.length === 0) {
	console.log("[migrate] No entries to classify");
	process.exit(0);
}

console.log(`[migrate] Guild: ${guildId}`);
console.log(`[migrate] Entries to classify: ${memory.entries.length}`);
console.log(`[migrate] Dry run: ${dryRun}`);
console.log();

// LLM で分類
const entriesList = memory.entries
	.map((e, i) => {
		const entry = normalizeEntry(e);
		return `[${i}] ${entry.text}`;
	})
	.join("\n");

const classifyPrompt = `
以下の記憶エントリをそれぞれ "guild"（サーバー固有）または "global"（全サーバー共通）に分類してください。

## 分類基準
- guild: ユーザー名を含む、サーバー内の出来事、ローカルな文脈
- global: 一般知識、技術的な学び、自分自身の気づき、普遍的な洞察、[dream] タグ付き

## エントリ
${entriesList}

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "classifications": [
    {"index": 0, "scope": "guild", "reason": "理由"},
    {"index": 1, "scope": "global", "reason": "理由"}
  ]
}
`.trim();

try {
	const response = await llm.chat.completions.create({
		model,
		messages: [{ role: "user", content: classifyPrompt }],
		temperature: 0.2,
		max_tokens: 4096,
	});

	const raw = response.choices[0]?.message?.content?.trim();
	if (!raw) {
		console.error("[migrate] Empty response from LLM");
		process.exit(1);
	}

	const cleaned = raw
		.replace(/^```(?:json)?\s*\n?/i, "")
		.replace(/\n?```\s*$/i, "");
	const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		console.error("[migrate] No JSON found in response:", raw);
		process.exit(1);
	}

	const result = JSON.parse(jsonMatch[0]) as ClassifyResult;

	const globalEntries: MemoryEntry[] = [];
	const guildEntries: Array<{ index: number; text: string; reason: string }> =
		[];

	for (const c of result.classifications) {
		const rawEntry = memory.entries[c.index];
		if (!rawEntry) continue;
		const entry = normalizeEntry(rawEntry);
		if (c.scope === "global") {
			globalEntries.push(entry);
			console.log(`  [GLOBAL] [${c.index}] ${entry.text} — ${c.reason}`);
		} else {
			guildEntries.push({ index: c.index, text: entry.text, reason: c.reason });
			console.log(`  [GUILD]  [${c.index}] ${entry.text} — ${c.reason}`);
		}
	}

	console.log();
	console.log(
		`[migrate] Global: ${globalEntries.length}, Guild: ${guildEntries.length}`,
	);

	if (dryRun) {
		console.log("[migrate] Dry run — no changes written");
		process.exit(0);
	}

	if (globalEntries.length === 0) {
		console.log("[migrate] No global entries to add");
		process.exit(0);
	}

	// global-memory.json に追加
	const gmPath = globalMemoryPath();
	let globalMemory: GlobalMemory;
	try {
		globalMemory = JSON.parse(readFileSync(gmPath, "utf-8")) as GlobalMemory;
	} catch {
		globalMemory = { entries: [], last_updated: "" };
	}

	for (const entry of globalEntries) {
		// 重複チェック
		if (!globalMemory.entries.some((e) => e.text === entry.text)) {
			globalMemory.entries.push(entry);
		}
	}

	globalMemory.last_updated = new Date().toISOString();
	writeFileSync(gmPath, JSON.stringify(globalMemory, null, "\t"), "utf-8");

	console.log(
		`[migrate] Added ${globalEntries.length} entries to global-memory.json (total: ${globalMemory.entries.length})`,
	);
	console.log("[migrate] Original guild memory is unchanged (safe migration)");
} catch (error) {
	console.error("[migrate] Error:", error);
	process.exit(1);
}
