import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const DATA_DIR = join(import.meta.dir, "../../data");
const MEMORY_PATH = join(DATA_DIR, "memory.json");
const DAILY_DIR = join(DATA_DIR, "memory");

const MAX_ENTRIES = 100;
const MAX_USER_NOTES = 10;
const PROMPT_TOP_ENTRIES = 20;

// 簡易 mutex: ファイルの Read-Modify-Write を直列化する
let memoryLock = Promise.resolve();

function withMemoryLock<T>(fn: () => T): Promise<T> {
	const next = memoryLock.then(fn, fn);
	memoryLock = next.then(
		() => {},
		() => {},
	);
	return next;
}

function ensureDailyDir(): void {
	if (!existsSync(DAILY_DIR)) {
		mkdirSync(DAILY_DIR, { recursive: true });
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

export function loadMemory(): Memory {
	try {
		const raw = readFileSync(MEMORY_PATH, "utf-8");
		return JSON.parse(raw) as Memory;
	} catch {
		const defaultMemory: Memory = {
			entries: [],
			user_notes: {},
			last_updated: "",
		};
		saveMemory(defaultMemory);
		return defaultMemory;
	}
}

export function saveMemory(memory: Memory): void {
	memory.last_updated = new Date().toISOString();
	writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, "\t"), "utf-8");
}

export function appendMemoryEntry(
	entry: string,
	emotionalImpact = 2,
): Promise<void> {
	return withMemoryLock(() => {
		const memory = loadMemory();
		const memoryEntry: MemoryEntry = {
			text: entry,
			emotional_impact: Math.max(1, Math.min(5, emotionalImpact)),
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
		saveMemory(memory);
		appendDailyEntry(entry);
		console.log(`[memory] Added (impact=${emotionalImpact}): ${entry}`);
	});
}

export function addUserNote(username: string, note: string): Promise<void> {
	return withMemoryLock(() => {
		const memory = loadMemory();
		if (!memory.user_notes[username]) {
			memory.user_notes[username] = [];
		}
		memory.user_notes[username].push(note);
		if (memory.user_notes[username].length > MAX_USER_NOTES) {
			memory.user_notes[username] = memory.user_notes[username].slice(
				-MAX_USER_NOTES,
			);
		}
		saveMemory(memory);
		console.log(`[memory] User note for ${username}:`, note);
	});
}

export function memoryToPrompt(memory: Memory): string {
	// スコアの上位 PROMPT_TOP_ENTRIES 件を選択
	const normalized = memory.entries.map(normalizeEntry);
	const scored = normalized
		.map((entry, idx) => ({ entry, idx, score: computeRecallScore(entry) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, PROMPT_TOP_ENTRIES);

	let prompt = "\n## 記憶 (MEMORY)\n";

	if (scored.length > 0) {
		prompt += "### 思い出せる記憶（スコア順）\n";
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

	if (scored.length === 0 && usernames.length === 0) {
		prompt += "(まだ記憶はありません)\n";
	}

	return prompt;
}

function todayKey(): string {
	return new Date().toISOString().slice(0, 10);
}

export function appendDailyEntry(entry: string): void {
	ensureDailyDir();
	const key = todayKey();
	const daily = loadDailyMemory(key);
	daily.entries.push(entry);
	saveDailyMemory(key, daily);
}

export function loadDailyMemory(dateKey: string): DailyMemory {
	const filePath = join(DAILY_DIR, `${dateKey}.json`);
	try {
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as DailyMemory;
	} catch {
		return { date: dateKey, entries: [] };
	}
}

export function saveDailyMemory(dateKey: string, daily: DailyMemory): void {
	ensureDailyDir();
	const filePath = join(DAILY_DIR, `${dateKey}.json`);
	writeFileSync(filePath, JSON.stringify(daily, null, "\t"), "utf-8");
}

export function processMemoryFields(fields: {
	memory_entry?: string | null;
	user_note?: string | null;
}): void {
	if (fields.memory_entry) {
		appendMemoryEntry(fields.memory_entry);
	}
	if (fields.user_note) {
		const colonIndex = fields.user_note.indexOf(":");
		if (colonIndex > 0) {
			const username = fields.user_note.slice(0, colonIndex).trim();
			const note = fields.user_note.slice(colonIndex + 1).trim();
			if (username && note) {
				addUserNote(username, note);
			}
		}
	}
}
