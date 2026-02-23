import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { goalTools } from "../../src/agent/tools/goals.ts";
import { guildGoalsPath } from "../../src/data/paths.ts";
import { createMockContext } from "../helpers/mock-context.ts";
import { createTestTables } from "../helpers/test-db.ts";

const GUILD_ID = "test-guild-goal-tools";

function getHandler(name: string) {
	const tool = goalTools.find((t) => t.spec.function.name === name);
	if (!tool) throw new Error(`Tool not found: ${name}`);
	return tool.handler;
}

beforeAll(() => {
	createTestTables();
});

afterEach(() => {
	const goalsPath = guildGoalsPath(GUILD_ID);
	if (existsSync(goalsPath)) rmSync(goalsPath);
});

describe("set_goal", () => {
	test("正常にゴールを追加できる", async () => {
		const handler = getHandler("set_goal");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler(
			{
				title: "テストゴール",
				description: "テスト用のゴールです",
				priority: "high",
			},
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.result).toContain("Goal set");

		const raw = readFileSync(guildGoalsPath(GUILD_ID), "utf-8");
		const data = JSON.parse(raw);
		expect(data.goals).toHaveLength(1);
		expect(data.goals[0].title).toBe("テストゴール");
		expect(data.goals[0].priority).toBe("high");
	});

	test("5つ超過でエラーになる", async () => {
		const handler = getHandler("set_goal");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		// 5つ追加
		for (let i = 0; i < 5; i++) {
			await handler({ title: `goal-${i}`, description: `desc-${i}` }, ctx);
		}

		// 6つ目はエラー
		const result = await handler(
			{ title: "goal-overflow", description: "desc" },
			ctx,
		);
		expect(result.success).toBe(false);
		expect(result.result).toContain("Maximum active goals");
	});
});

describe("update_goal_progress", () => {
	test("進捗メモを追加できる", async () => {
		const setHandler = getHandler("set_goal");
		const updateHandler = getHandler("update_goal_progress");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const setResult = await setHandler(
			{ title: "テスト", description: "テスト" },
			ctx,
		);
		// レスポンスからゴール ID を抽出
		const idMatch = setResult.result.match(/id=(goal_\d+)/);
		expect(idMatch).not.toBeNull();
		const goalId = idMatch?.[1] ?? "";

		const result = await updateHandler(
			{ goal_id: goalId, note: "50% 完了" },
			ctx,
		);
		expect(result.success).toBe(true);

		const raw = readFileSync(guildGoalsPath(GUILD_ID), "utf-8");
		const data = JSON.parse(raw);
		expect(data.goals[0].progress_notes).toHaveLength(1);
		expect(data.goals[0].progress_notes[0]).toContain("50% 完了");
	});
});

describe("complete_goal", () => {
	test("ゴールを完了できる", async () => {
		const setHandler = getHandler("set_goal");
		const completeHandler = getHandler("complete_goal");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const setResult = await setHandler(
			{ title: "完了テスト", description: "完了させるゴール" },
			ctx,
		);
		const idMatch = setResult.result.match(/id=(goal_\d+)/);
		const goalId = idMatch?.[1] ?? "";

		const result = await completeHandler({ goal_id: goalId }, ctx);
		expect(result.success).toBe(true);

		const raw = readFileSync(guildGoalsPath(GUILD_ID), "utf-8");
		const data = JSON.parse(raw);
		expect(data.goals[0].status).toBe("completed");
	});
});

describe("list_goals", () => {
	test("アクティブなゴール一覧を返す", async () => {
		const setHandler = getHandler("set_goal");
		const listHandler = getHandler("list_goals");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		await setHandler({ title: "ゴールA", description: "説明A" }, ctx);
		await setHandler({ title: "ゴールB", description: "説明B" }, ctx);

		const result = await listHandler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("ゴールA");
		expect(result.result).toContain("ゴールB");
	});

	test("ゴールがない場合はメッセージを返す", async () => {
		const listHandler = getHandler("list_goals");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await listHandler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("No active goals");
	});
});
