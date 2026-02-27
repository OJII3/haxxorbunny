import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	globalMemoryPath,
	guildDailyMemoryDir,
	guildMemoryPath,
} from "../data/paths.ts";
import { filterMemoryEntry } from "./memory-filter.ts";

/** 感情付き記憶エントリ */
export interface MemoryEntry {
	text: string;
	emotional_impact: number; // 1-5 (1=些細, 5=非常に印象的)
	created_at: string; // ISO 8601
}

export interface Memory {
	entries: (string | MemoryEntry)[];
	user_notes: Record<string, string[]>;
	last_updated: string;
}

interface DailyMemory {
	date: string;
	entries: string[];
}

/** グローバルメモリ: サーバーに依存しない一般知識・夢の洞察 */
export interface GlobalMemory {
	entries: MemoryEntry[];
	last_updated: string;
}

const MAX_ENTRIES = 100;
const MAX_USER_NOTES = 10;
const PROMPT_TOP_ENTRIES = 20;
const GLOBAL_MAX_ENTRIES = 50;
const GLOBAL_PROMPT_TOP_ENTRIES = 15;
const DEDUP_PREFIX_LENGTH = 15;
const DEDUP_MIN_CONTAINMENT_LENGTH = 5;

/**
 * 重複チェック用にテキストを正規化する
 * 句読点・スペース・記号を除去して比較しやすくする
 */
export function normalizeTextForComparison(text: string): string {
	return text
		.replace(
			/[\s\u3000.,、。!！?？…・:：;；（）()「」『』【】\-\u2014\u2015]/g,
			"",
		)
		.toLowerCase();
}

/**
 * 既存記憶リストから重複エントリを検索する
 * - 完全一致（正規化後）
 * - 一方が他方を含む（包含関係）
 * - 先頭 DEDUP_PREFIX_LENGTH 文字が一致
 *
 * @returns 重複エントリのインデックス（見つからなければ -1）
 */
export function findDuplicateIndex(
	entries: (string | MemoryEntry)[],
	newText: string,
): number {
	const normalizedNew = normalizeTextForComparison(newText);
	if (normalizedNew.length === 0) return -1;

	for (let i = 0; i < entries.length; i++) {
		const existing = entries[i];
		if (existing === undefined) continue;
		const existingText =
			typeof existing === "string" ? existing : existing.text;
		const normalizedExisting = normalizeTextForComparison(existingText);
		if (normalizedExisting.length === 0) continue;

		// 完全一致
		if (normalizedNew === normalizedExisting) return i;

		// 包含関係: 一方が他方を含む（短い側が DEDUP_MIN_CONTAINMENT_LENGTH 文字以上の場合のみ）
		const shorter = Math.min(normalizedNew.length, normalizedExisting.length);
		if (shorter >= DEDUP_MIN_CONTAINMENT_LENGTH) {
			if (
				normalizedNew.includes(normalizedExisting) ||
				normalizedExisting.includes(normalizedNew)
			) {
				return i;
			}
		}

		// 先頭 N 文字が一致（N 文字以上のテキスト同士のみ）
		if (
			normalizedNew.length >= DEDUP_PREFIX_LENGTH &&
			normalizedExisting.length >= DEDUP_PREFIX_LENGTH &&
			normalizedNew.slice(0, DEDUP_PREFIX_LENGTH) ===
				normalizedExisting.slice(0, DEDUP_PREFIX_LENGTH)
		) {
			return i;
		}
	}

	return -1;
}

// 簡易 mutex: ギルドごとにファイルの Read-Modify-Write を直列化する
const memoryLocks = new Map<string, Promise<void>>();

function withMemoryLock<T>(guildId: string, fn: () => T): Promise<T> {
	const current = memoryLocks.get(guildId) ?? Promise.resolve();
	const next = current.then(fn, fn);
	memoryLocks.set(
		guildId,
		next.then(
			() => {},
			() => {},
		),
	);
	return next;
}

function ensureDailyDir(guildId: string): void {
	const dir = guildDailyMemoryDir(guildId);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/** string → MemoryEntry に自動変換（後方互換） */
export function normalizeEntry(raw: string | MemoryEntry): MemoryEntry {
	if (typeof raw === "string") {
		return {
			text: raw,
			emotional_impact: 2, // デフォルト中程度
			created_at: new Date().toISOString(),
		};
	}
	return raw;
}

/**
 * 記憶のリコールスコアを計算
 * 0.6*recency + 0.3*emotion + 0.1*random
 * recency: エビングハウス忘却曲線（30日半減期）
 */
export function computeRecallScore(entry: MemoryEntry): number {
	const now = Date.now();
	const created = new Date(entry.created_at).getTime();
	const daysSinceCreation = (now - created) / (1000 * 60 * 60 * 24);

	// エビングハウス忘却曲線: retention = e^(-t/halfLife * ln(2))
	const halfLife = 30; // 30日半減期
	const recency = Math.exp((-daysSinceCreation / halfLife) * Math.LN2);

	// emotional_impact を 0-1 にノーマライズ (1-5 → 0-1)
	const emotion = (entry.emotional_impact - 1) / 4;

	const random = Math.random();

	return 0.6 * recency + 0.3 * emotion + 0.1 * random;
}

export function loadMemory(guildId: string): Memory {
	const memoryPath = guildMemoryPath(guildId);
	try {
		const raw = readFileSync(memoryPath, "utf-8");
		return JSON.parse(raw) as Memory;
	} catch {
		const defaultMemory: Memory = {
			entries: [],
			user_notes: {},
			last_updated: "",
		};
		saveMemory(guildId, defaultMemory);
		return defaultMemory;
	}
}

export function saveMemory(guildId: string, memory: Memory): void {
	memory.last_updated = new Date().toISOString();
	const memoryPath = guildMemoryPath(guildId);
	writeFileSync(memoryPath, JSON.stringify(memory, null, "\t"), "utf-8");
}

export function loadGlobalMemory(): GlobalMemory {
	const memPath = globalMemoryPath();
	try {
		const raw = readFileSync(memPath, "utf-8");
		return JSON.parse(raw) as GlobalMemory;
	} catch {
		const defaultMemory: GlobalMemory = {
			entries: [],
			last_updated: "",
		};
		saveGlobalMemory(defaultMemory);
		return defaultMemory;
	}
}

export function saveGlobalMemory(memory: GlobalMemory): void {
	memory.last_updated = new Date().toISOString();
	const memPath = globalMemoryPath();
	writeFileSync(memPath, JSON.stringify(memory, null, "\t"), "utf-8");
}

export function appendGlobalMemoryEntry(
	entry: string,
	emotionalImpact = 3,
): Promise<void> {
	// AI/bot 自覚フィルタ
	if (filterMemoryEntry(entry, "appendGlobalMemoryEntry")) {
		return Promise.resolve();
	}
	return withMemoryLock("__global__", () => {
		const memory = loadGlobalMemory();
		const clampedImpact = Math.max(1, Math.min(5, emotionalImpact));

		// 重複チェック
		const dupIndex = findDuplicateIndex(memory.entries, entry);
		if (dupIndex !== -1) {
			const existing = memory.entries[dupIndex] as MemoryEntry;
			// 新しい impact が高ければ既存を更新
			if (clampedImpact > existing.emotional_impact) {
				const oldImpact = existing.emotional_impact;
				memory.entries[dupIndex] = {
					...existing,
					emotional_impact: clampedImpact,
				};
				saveGlobalMemory(memory);
				console.log(
					`[global-memory] Skipped duplicate (impact updated ${oldImpact}→${clampedImpact}): ${entry}`,
				);
			} else {
				console.log(
					`[global-memory] Skipped duplicate: ${entry} (existing: ${existing.text})`,
				);
			}
			return;
		}

		const memoryEntry: MemoryEntry = {
			text: entry,
			emotional_impact: clampedImpact,
			created_at: new Date().toISOString(),
		};
		memory.entries.push(memoryEntry);
		if (memory.entries.length > GLOBAL_MAX_ENTRIES) {
			const scored = memory.entries
				.map((e) => ({
					entry: e,
					score: computeRecallScore(normalizeEntry(e)),
				}))
				.sort((a, b) => b.score - a.score);
			memory.entries = scored.slice(0, GLOBAL_MAX_ENTRIES).map((s) => s.entry);
		}
		saveGlobalMemory(memory);
		console.log(`[global-memory] Added (impact=${emotionalImpact}): ${entry}`);
	});
}

/** グローバルメモリを GLOBAL_MAX_ENTRIES に収まるようトリミングする */
export function trimGlobalMemory(): void {
	const memory = loadGlobalMemory();
	if (memory.entries.length <= GLOBAL_MAX_ENTRIES) return;
	const scored = memory.entries
		.map((e) => {
			const entry = normalizeEntry(e);
			return { entry, score: computeRecallScore(entry) };
		})
		.sort((a, b) => b.score - a.score);
	memory.entries = scored.slice(0, GLOBAL_MAX_ENTRIES).map((s) => s.entry);
	saveGlobalMemory(memory);
	console.log(`[global-memory] Trimmed to ${GLOBAL_MAX_ENTRIES} entries`);
}

export function appendMemoryEntry(
	guildId: string,
	entry: string,
	emotionalImpact = 2,
): Promise<void> {
	// AI/bot 自覚フィルタ
	if (filterMemoryEntry(entry, "appendMemoryEntry")) {
		return Promise.resolve();
	}
	return withMemoryLock(guildId, () => {
		const memory = loadMemory(guildId);
		const clampedImpact = Math.max(1, Math.min(5, emotionalImpact));

		// 重複チェック
		const dupIndex = findDuplicateIndex(memory.entries, entry);
		if (dupIndex !== -1) {
			const rawExisting = memory.entries[dupIndex] as string | MemoryEntry;
			const existing = normalizeEntry(rawExisting);
			// 新しい impact が高ければ既存を更新
			if (clampedImpact > existing.emotional_impact) {
				memory.entries[dupIndex] = {
					...existing,
					emotional_impact: clampedImpact,
				};
				saveMemory(guildId, memory);
				console.log(
					`[memory] Skipped duplicate (impact updated ${existing.emotional_impact}→${clampedImpact}): ${entry}`,
				);
			} else {
				console.log(
					`[memory] Skipped duplicate: ${entry} (existing: ${existing.text})`,
				);
			}
			return;
		}

		const memoryEntry: MemoryEntry = {
			text: entry,
			emotional_impact: clampedImpact,
			created_at: new Date().toISOString(),
		};
		memory.entries.push(memoryEntry);
		if (memory.entries.length > MAX_ENTRIES) {
			// スコアの低い記憶を削除
			const scored = memory.entries
				.map((e) => ({
					entry: e,
					score: computeRecallScore(normalizeEntry(e)),
				}))
				.sort((a, b) => b.score - a.score);
			memory.entries = scored.slice(0, MAX_ENTRIES).map((s) => s.entry);
		}
		saveMemory(guildId, memory);
		appendDailyEntry(guildId, entry);
		console.log(`[memory] Added (impact=${emotionalImpact}): ${entry}`);
	});
}

export function addUserNote(
	guildId: string,
	username: string,
	note: string,
): Promise<void> {
	return withMemoryLock(guildId, () => {
		const memory = loadMemory(guildId);
		if (!memory.user_notes[username]) {
			memory.user_notes[username] = [];
		}
		memory.user_notes[username].push(note);
		if (memory.user_notes[username].length > MAX_USER_NOTES) {
			memory.user_notes[username] = memory.user_notes[username].slice(
				-MAX_USER_NOTES,
			);
		}
		saveMemory(guildId, memory);
		console.log(`[memory] User note for ${username}:`, note);
	});
}

export function memoryToPrompt(
	memory: Memory,
	globalMemory?: GlobalMemory,
): string {
	let prompt = "\n## 記憶 (MEMORY)\n";

	// グローバルメモリ（共通の記憶）
	if (globalMemory && globalMemory.entries.length > 0) {
		const globalNormalized = globalMemory.entries.map(normalizeEntry);
		const globalScored = globalNormalized
			.map((entry, idx) => ({
				entry,
				idx,
				score: computeRecallScore(entry),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, GLOBAL_PROMPT_TOP_ENTRIES);

		if (globalScored.length > 0) {
			prompt += "### 共通の記憶\n";
			for (const { entry } of globalScored) {
				const impactMark =
					entry.emotional_impact >= 4
						? " ⚡"
						: entry.emotional_impact >= 3
							? " ✦"
							: "";
				prompt += `- ${entry.text}${impactMark}\n`;
			}
		}
	}

	// ギルドメモリ（このサーバーの記憶）
	const normalized = memory.entries.map(normalizeEntry);
	const scored = normalized
		.map((entry, idx) => ({ entry, idx, score: computeRecallScore(entry) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, PROMPT_TOP_ENTRIES);

	if (scored.length > 0) {
		prompt += "### このサーバーの記憶（スコア順）\n";
		for (const { entry } of scored) {
			const impactMark =
				entry.emotional_impact >= 4
					? " ⚡"
					: entry.emotional_impact >= 3
						? " ✦"
						: "";
			prompt += `- ${entry.text}${impactMark}\n`;
		}
	}

	const usernames = Object.keys(memory.user_notes);
	if (usernames.length > 0) {
		prompt += "### ユーザーメモ\n";
		for (const username of usernames) {
			const notes = memory.user_notes[username] ?? [];
			if (notes.length > 0) {
				prompt += `- ${username}: ${notes.join(" / ")}\n`;
			}
		}
	}

	const hasGlobalEntries = globalMemory && globalMemory.entries.length > 0;
	if (scored.length === 0 && usernames.length === 0 && !hasGlobalEntries) {
		prompt += "(まだ記憶はありません)\n";
	}

	return prompt;
}

function todayKey(): string {
	return new Date().toISOString().slice(0, 10);
}

export function appendDailyEntry(guildId: string, entry: string): void {
	ensureDailyDir(guildId);
	const key = todayKey();
	const daily = loadDailyMemory(guildId, key);
	daily.entries.push(entry);
	saveDailyMemory(guildId, key, daily);
}

export function loadDailyMemory(guildId: string, dateKey: string): DailyMemory {
	const dir = guildDailyMemoryDir(guildId);
	const filePath = join(dir, `${dateKey}.json`);
	try {
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as DailyMemory;
	} catch {
		return { date: dateKey, entries: [] };
	}
}

export function saveDailyMemory(
	guildId: string,
	dateKey: string,
	daily: DailyMemory,
): void {
	ensureDailyDir(guildId);
	const dir = guildDailyMemoryDir(guildId);
	const filePath = join(dir, `${dateKey}.json`);
	writeFileSync(filePath, JSON.stringify(daily, null, "\t"), "utf-8");
}

export function processMemoryFields(
	guildId: string,
	fields: {
		memory_entry?: string | null;
		user_note?: string | null;
	},
): void {
	if (
		fields.memory_entry &&
		!filterMemoryEntry(fields.memory_entry, "processMemoryFields")
	) {
		appendMemoryEntry(guildId, fields.memory_entry);
	}
	if (fields.user_note) {
		const colonIndex = fields.user_note.indexOf(":");
		if (colonIndex > 0) {
			const username = fields.user_note.slice(0, colonIndex).trim();
			const note = fields.user_note.slice(colonIndex + 1).trim();
			if (username && note) {
				addUserNote(guildId, username, note);
			}
		}
	}
}
