import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { guildMemoryPath } from "../../src/data/paths.ts";
import {
	addUserNote,
	appendMemoryEntry,
	computeRecallScore,
	loadMemory,
	type MemoryEntry,
	memoryToPrompt,
	normalizeEntry,
	saveMemory,
} from "../../src/llm/memory.ts";
import { createTestTables } from "../helpers/test-db.ts";

const GUILD_ID = "test-guild-llm-memory";

beforeAll(() => {
	createTestTables();
});

afterEach(() => {
	const memPath = guildMemoryPath(GUILD_ID);
	if (existsSync(memPath)) rmSync(memPath);
});

describe("normalizeEntry", () => {
	test("string を MemoryEntry に変換する", () => {
		const result = normalizeEntry("test memory");
		expect(result.text).toBe("test memory");
		expect(result.emotional_impact).toBe(2);
		expect(result.created_at).toBeTruthy();
	});

	test("MemoryEntry はそのまま返す", () => {
		const entry: MemoryEntry = {
			text: "existing",
			emotional_impact: 4,
			created_at: "2025-01-01T00:00:00.000Z",
		};
		const result = normalizeEntry(entry);
		expect(result).toBe(entry);
	});
});

describe("computeRecallScore", () => {
	test("新しい記憶は高スコアになる", () => {
		const recent: MemoryEntry = {
			text: "recent",
			emotional_impact: 3,
			created_at: new Date().toISOString(),
		};
		const score = computeRecallScore(recent);
		// recency ≈ 1.0, emotion = 0.5, random ∈ [0,1]
		// 0.6 * 1.0 + 0.3 * 0.5 + 0.1 * [0..1] = 0.75 ~ 0.85
		expect(score).toBeGreaterThan(0.5);
	});

	test("感情的インパクトが高い記憶はスコアが高い", () => {
		const now = new Date().toISOString();
		const lowImpact: MemoryEntry = {
			text: "low",
			emotional_impact: 1,
			created_at: now,
		};
		const highImpact: MemoryEntry = {
			text: "high",
			emotional_impact: 5,
			created_at: now,
		};

		// ランダム要素があるので複数回比較して傾向を確認
		let highWins = 0;
		for (let i = 0; i < 20; i++) {
			if (computeRecallScore(highImpact) > computeRecallScore(lowImpact)) {
				highWins++;
			}
		}
		// ほとんどのケースで高インパクトが勝つはず
		expect(highWins).toBeGreaterThan(10);
	});
});

describe("loadMemory / saveMemory", () => {
	test("存在しない場合はデフォルトを返す", () => {
		const memory = loadMemory(GUILD_ID);
		expect(memory.entries).toEqual([]);
		expect(memory.user_notes).toEqual({});
	});

	test("保存したデータを読み込める", () => {
		const memory = loadMemory(GUILD_ID);
		memory.entries.push({
			text: "test",
			emotional_impact: 3,
			created_at: new Date().toISOString(),
		});
		saveMemory(GUILD_ID, memory);

		const loaded = loadMemory(GUILD_ID);
		expect(loaded.entries).toHaveLength(1);
		expect((loaded.entries[0] as MemoryEntry).text).toBe("test");
	});
});

describe("appendMemoryEntry", () => {
	test("エントリを追加してファイルに永続化する", async () => {
		await appendMemoryEntry(GUILD_ID, "新しい記憶", 3);

		const memory = loadMemory(GUILD_ID);
		expect(memory.entries).toHaveLength(1);
		const entry = memory.entries[0] as MemoryEntry;
		expect(entry.text).toBe("新しい記憶");
		expect(entry.emotional_impact).toBe(3);
	});

	test("emotional_impact が 1-5 にクランプされる", async () => {
		await appendMemoryEntry(GUILD_ID, "low", 0);
		await appendMemoryEntry(GUILD_ID, "high", 10);

		const memory = loadMemory(GUILD_ID);
		expect((memory.entries[0] as MemoryEntry).emotional_impact).toBe(1);
		expect((memory.entries[1] as MemoryEntry).emotional_impact).toBe(5);
	});
});

describe("addUserNote", () => {
	test("ユーザーメモを追加できる", async () => {
		await addUserNote(GUILD_ID, "alice", "Nix好き");
		await addUserNote(GUILD_ID, "alice", "猫派");

		const memory = loadMemory(GUILD_ID);
		expect(memory.user_notes.alice).toHaveLength(2);
		expect(memory.user_notes.alice).toContain("Nix好き");
		expect(memory.user_notes.alice).toContain("猫派");
	});

	test("MAX_USER_NOTES (10) を超えると古いものが削除される", async () => {
		for (let i = 0; i < 12; i++) {
			await addUserNote(GUILD_ID, "bob", `note-${i}`);
		}

		const memory = loadMemory(GUILD_ID);
		expect(memory.user_notes.bob).toHaveLength(10);
		// 最初の2つ (note-0, note-1) が削除されている
		expect(memory.user_notes.bob?.[0]).toBe("note-2");
	});
});

describe("memoryToPrompt", () => {
	test("記憶とユーザーメモからプロンプトを生成する", () => {
		const memory = loadMemory(GUILD_ID);
		memory.entries.push({
			text: "テスト記憶",
			emotional_impact: 4,
			created_at: new Date().toISOString(),
		});
		memory.user_notes.alice = ["Nix好き"];
		saveMemory(GUILD_ID, memory);

		const prompt = memoryToPrompt(memory);
		expect(prompt).toContain("テスト記憶");
		expect(prompt).toContain("alice");
		expect(prompt).toContain("Nix好き");
	});

	test("記憶がない場合は適切なメッセージを含む", () => {
		const memory = loadMemory(GUILD_ID);
		const prompt = memoryToPrompt(memory);
		expect(prompt).toContain("まだ記憶はありません");
	});
});
