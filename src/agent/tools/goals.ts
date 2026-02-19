import {
	addGoal,
	completeGoal,
	getActiveGoals,
	updateGoalProgress,
} from "../../llm/goals.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const setGoalHandler: ToolHandler = async (args) => {
	const title = args.title as string;
	const description = args.description as string;
	const priority = (args.priority as "low" | "medium" | "high") ?? "medium";

	if (!title || !description) return fail("title and description are required");

	const goal = addGoal(title, description, priority);
	if (!goal)
		return fail(
			"Maximum active goals (5) reached. Complete or abandon a goal first.",
		);

	return ok(
		`Goal set: "${goal.title}" (id=${goal.id}, priority=${goal.priority})`,
	);
};

const updateGoalProgressHandler: ToolHandler = async (args) => {
	const goalId = args.goal_id as string;
	const note = args.note as string;

	if (!goalId || !note) return fail("goal_id and note are required");

	const success = updateGoalProgress(goalId, note);
	if (!success) return fail(`Goal not found or not active: ${goalId}`);

	return ok(`Progress updated for ${goalId}: ${note}`);
};

const completeGoalHandler: ToolHandler = async (args) => {
	const goalId = args.goal_id as string;
	if (!goalId) return fail("goal_id is required");

	const success = completeGoal(goalId);
	if (!success) return fail(`Goal not found or not active: ${goalId}`);

	return ok(`Goal completed: ${goalId}`);
};

const listGoalsHandler: ToolHandler = async () => {
	const active = getActiveGoals();
	if (active.length === 0) return ok("No active goals.");

	const list = active
		.map(
			(g) =>
				`- [${g.priority}] ${g.title} (id=${g.id}): ${g.description}${g.progress_notes.length > 0 ? ` | notes: ${g.progress_notes.length}` : ""}`,
		)
		.join("\n");

	return ok(`Active goals:\n${list}`);
};

export const goalTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "set_goal",
				description:
					"新しい目標を設定する。何か達成したいことがあるときに使う（最大5つ）",
				parameters: {
					type: "object",
					properties: {
						title: {
							type: "string",
							description: "目標のタイトル（短く）",
						},
						description: {
							type: "string",
							description: "目標の詳細説明",
						},
						priority: {
							type: "string",
							enum: ["low", "medium", "high"],
							description: "優先度（デフォルト: medium）",
						},
					},
					required: ["title", "description"],
				},
			},
		},
		handler: setGoalHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "update_goal_progress",
				description: "目標の進捗メモを追加する",
				parameters: {
					type: "object",
					properties: {
						goal_id: {
							type: "string",
							description: "目標の ID",
						},
						note: {
							type: "string",
							description: "進捗メモ",
						},
					},
					required: ["goal_id", "note"],
				},
			},
		},
		handler: updateGoalProgressHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "complete_goal",
				description: "目標を達成済みにする",
				parameters: {
					type: "object",
					properties: {
						goal_id: {
							type: "string",
							description: "目標の ID",
						},
					},
					required: ["goal_id"],
				},
			},
		},
		handler: completeGoalHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "list_goals",
				description: "アクティブな目標の一覧を表示する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: listGoalsHandler,
	},
];
