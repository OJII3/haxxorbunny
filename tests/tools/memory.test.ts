import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { memoryTools } from "../../src/agent/tools/memory.ts";
import { guildMemoryPath, guildPersonalityPath } from "../../src/data/paths.ts";
import { IDENTITY_PROMPT, SOUL_PROMPT } from "../../src/llm/prompts/system.ts";
import { createMockContext } from "../helpers/mock-context.ts";
import { createTestTables } from "../helpers/test-db.ts";

const GUILD_ID = "test-guild-memory-tools";

// ツールハンドラを名前で引く
function getHandler(name: string) {
	const tool = memoryTools.find((t) => t.spec.function.name === name);
	if (!tool) throw new Error(`Tool not found: ${name}`);
	return tool.handler;
}

beforeAll(() => {
	createTestTables();
});

afterEach(() => {
	// ギルドデータをクリーンアップ
	const memPath = guildMemoryPath(GUILD_ID);
	if (existsSync(memPath)) rmSync(memPath);
	const persPath = guildPersonalityPath(GUILD_ID);
	if (existsSync(persPath)) rmSync(persPath);
});

describe("save_memory", () => {
	test("正常にメモリを保存できる", async () => {
		const handler = getHandler("save_memory");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ entry: "テスト記憶" }, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("Memory saved");

		// ファイルに永続化されている
		const raw = readFileSync(guildMemoryPath(GUILD_ID), "utf-8");
		const memory = JSON.parse(raw);
		expect(memory.entries).toHaveLength(1);
		expect(memory.entries[0].text).toBe("テスト記憶");
	});

	test("30文字超過でエラーになる", async () => {
		const handler = getHandler("save_memory");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ entry: "a".repeat(31) }, ctx);
		expect(result.success).toBe(false);
		expect(result.result).toContain("30 characters or less");
	});

	test("isMentioned=true 時に emotional_impact が最低3にフロアリングされる", async () => {
		const handler = getHandler("save_memory");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
			isMentioned: true,
		});

		const result = await handler(
			{ entry: "メンション記憶", emotional_impact: 1 },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.result).toContain("impact=3");

		const raw = readFileSync(guildMemoryPath(GUILD_ID), "utf-8");
		const memory = JSON.parse(raw);
		expect(memory.entries[0].emotional_impact).toBe(3);
	});
});

describe("save_user_note", () => {
	test("ユーザーメモを保存できる", async () => {
		const handler = getHandler("save_user_note");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ username: "alice", note: "Nix好き" }, ctx);
		expect(result.success).toBe(true);

		const raw = readFileSync(guildMemoryPath(GUILD_ID), "utf-8");
		const memory = JSON.parse(raw);
		expect(memory.user_notes.alice).toContain("Nix好き");
	});

	test("username と note が空の場合エラーになる", async () => {
		const handler = getHandler("save_user_note");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ username: "", note: "" }, ctx);
		expect(result.success).toBe(false);
	});
});

describe("recall_identity", () => {
	test("SOUL_PROMPT と IDENTITY_PROMPT を返す", async () => {
		const handler = getHandler("recall_identity");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain(SOUL_PROMPT);
		expect(result.result).toContain(IDENTITY_PROMPT);
	});
});

describe("update_personality", () => {
	test("mood を更新しファイルに永続化される", async () => {
		const handler = getHandler("update_personality");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler(
			{
				mood: {
					energy: 0.8,
					positivity: 0.9,
					sociability: 0.6,
					curiosity: 0.7,
				},
			},
			ctx,
		);
		expect(result.success).toBe(true);

		const raw = readFileSync(guildPersonalityPath(GUILD_ID), "utf-8");
		const personality = JSON.parse(raw);
		// 補間が適用されるため元の値とは少し異なる
		expect(personality.mood.energy).toBeGreaterThan(0.5);
	});

	test("引数が空の場合エラーになる", async () => {
		const handler = getHandler("update_personality");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({}, ctx);
		expect(result.success).toBe(false);
	});
});
