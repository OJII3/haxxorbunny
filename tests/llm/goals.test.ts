import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { guildGoalsPath } from "../../src/data/paths.ts";
import {
	abandonGoal,
	addGoal,
	completeGoal,
	getActiveGoals,
	goalsToPrompt,
	loadGoals,
	updateGoalProgress,
} from "../../src/llm/goals.ts";
import { createTestTables } from "../helpers/test-db.ts";

const GUILD_ID = "test-guild-llm-goals";

/** addGoal の結果が null でないことを assert して返す */
function addGoalOrFail(
	...args: Parameters<typeof addGoal>
): ReturnType<typeof addGoal> & { id: string } {
	const goal = addGoal(...args);
	expect(goal).not.toBeNull();
	return goal as ReturnType<typeof addGoal> & { id: string };
}

beforeAll(() => {
	createTestTables();
});

afterEach(() => {
	const goalsPath = guildGoalsPath(GUILD_ID);
	if (existsSync(goalsPath)) rmSync(goalsPath);
});

describe("addGoal / loadGoals", () => {
	test("ゴールを追加して永続化できる", () => {
		const goal = addGoalOrFail(GUILD_ID, "テスト", "テストゴール", "high");
		expect(goal.title).toBe("テスト");
		expect(goal.priority).toBe("high");
		expect(goal.status).toBe("active");

		const data = loadGoals(GUILD_ID);
		expect(data.goals).toHaveLength(1);
	});

	test("MAX_ACTIVE_GOALS=5 の制限", () => {
		for (let i = 0; i < 5; i++) {
			addGoalOrFail(GUILD_ID, `goal-${i}`, "desc");
		}

		const overflow = addGoal(GUILD_ID, "overflow", "desc");
		expect(overflow).toBeNull();
	});

	test("completed ゴールはアクティブカウントに含まれない", () => {
		const g = addGoalOrFail(GUILD_ID, "to-complete", "desc");
		completeGoal(GUILD_ID, g.id);

		// 5つアクティブを追加できる
		for (let i = 0; i < 5; i++) {
			const result = addGoal(GUILD_ID, `goal-${i}`, "desc");
			expect(result).not.toBeNull();
		}
	});
});

describe("updateGoalProgress", () => {
	test("進捗メモを追加できる", () => {
		const goal = addGoalOrFail(GUILD_ID, "進捗テスト", "説明");

		const success = updateGoalProgress(GUILD_ID, goal.id, "50%完了");
		expect(success).toBe(true);

		const data = loadGoals(GUILD_ID);
		expect(data.goals[0]?.progress_notes).toHaveLength(1);
		expect(data.goals[0]?.progress_notes[0]).toContain("50%完了");
	});

	test("存在しないゴールには false を返す", () => {
		const success = updateGoalProgress(GUILD_ID, "nonexistent", "note");
		expect(success).toBe(false);
	});
});

describe("completeGoal", () => {
	test("ゴールを completed にする", () => {
		const goal = addGoalOrFail(GUILD_ID, "完了テスト", "説明");

		const success = completeGoal(GUILD_ID, goal.id);
		expect(success).toBe(true);

		const data = loadGoals(GUILD_ID);
		expect(data.goals[0]?.status).toBe("completed");
	});
});

describe("abandonGoal", () => {
	test("ゴールを abandoned にする", () => {
		const goal = addGoalOrFail(GUILD_ID, "放棄テスト", "説明");

		const success = abandonGoal(GUILD_ID, goal.id);
		expect(success).toBe(true);

		const data = loadGoals(GUILD_ID);
		expect(data.goals[0]?.status).toBe("abandoned");
	});
});

describe("getActiveGoals", () => {
	test("active なゴールのみ返す", async () => {
		addGoalOrFail(GUILD_ID, "active-1", "desc");
		// Date.now() ベースの ID 衝突を避けるため 1ms 待機
		await Bun.sleep(1);
		const toComplete = addGoalOrFail(GUILD_ID, "to-complete", "desc");
		await Bun.sleep(1);
		addGoalOrFail(GUILD_ID, "active-2", "desc");

		completeGoal(GUILD_ID, toComplete.id);

		const active = getActiveGoals(GUILD_ID);
		expect(active).toHaveLength(2);
		const titles = active.map((g) => g.title);
		expect(titles).not.toContain("to-complete");
	});
});

describe("goalsToPrompt", () => {
	test("priority 順にプロンプトを生成する", () => {
		addGoal(GUILD_ID, "低優先", "desc", "low");
		addGoal(GUILD_ID, "高優先", "desc", "high");
		addGoal(GUILD_ID, "中優先", "desc", "medium");

		const prompt = goalsToPrompt(GUILD_ID);
		const highIdx = prompt.indexOf("高優先");
		const medIdx = prompt.indexOf("中優先");
		const lowIdx = prompt.indexOf("低優先");

		expect(highIdx).toBeLessThan(medIdx);
		expect(medIdx).toBeLessThan(lowIdx);
	});

	test("ゴールがない場合は空文字を返す", () => {
		const prompt = goalsToPrompt(GUILD_ID);
		expect(prompt).toBe("");
	});

	test("進捗メモがあれば最新を含む", () => {
		const goal = addGoalOrFail(GUILD_ID, "進捗テスト", "説明");
		updateGoalProgress(GUILD_ID, goal.id, "第一歩");
		updateGoalProgress(GUILD_ID, goal.id, "半分完了");

		const prompt = goalsToPrompt(GUILD_ID);
		expect(prompt).toContain("半分完了");
	});
});
