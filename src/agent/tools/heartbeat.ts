import { loadHeartbeat, saveHeartbeat } from "../../llm/heartbeat.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const BUILTIN_TASK_IDS = new Set([
	"autonomous_post",
	"channel_patrol",
	"goal_check",
	"distill_memory",
	"cleanup_old_memory",
	"dream_processing",
]);

/** システムタスク（distill/cleanup/dream）のインターバル下限 */
const SYSTEM_TASK_MIN_INTERVAL = 360;
/** エージェントタスク（post/patrol/goal）のインターバル下限 */
const AGENT_TASK_MIN_INTERVAL = 60;
/** カスタムタスクのインターバル範囲 */
const CUSTOM_MIN_INTERVAL = 60;
const MAX_INTERVAL = 10080;
/** カスタムタスク最大数 */
const MAX_CUSTOM_TASKS = 5;
/** プロンプト最大長 */
const MAX_PROMPT_LENGTH = 500;
/** タスクID パターン */
const TASK_ID_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;

const SYSTEM_TASK_IDS = new Set([
	"distill_memory",
	"cleanup_old_memory",
	"dream_processing",
]);

function getMinInterval(taskId: string): number {
	if (SYSTEM_TASK_IDS.has(taskId)) return SYSTEM_TASK_MIN_INTERVAL;
	return AGENT_TASK_MIN_INTERVAL;
}

const listTasksHandler: ToolHandler = async () => {
	const heartbeat = loadHeartbeat();

	if (heartbeat.tasks.length === 0) return ok("定期タスクはありません。");

	const lines = heartbeat.tasks.map((t) => {
		const status = t.enabled ? "有効" : "無効";
		const type = t.type === "custom" ? "カスタム" : "ビルトイン";
		const lastExec = t.last_executed ?? "未実行";
		let line = `- ${t.id} [${type}] (${status}): ${t.description} | 間隔: ${t.interval_minutes}分 | 最終実行: ${lastExec}`;
		if (t.prompt) {
			line += ` | プロンプト: ${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? "…" : ""}`;
		}
		return line;
	});

	return ok(`定期タスク一覧:\n${lines.join("\n")}`);
};

const updateTaskHandler: ToolHandler = async (args) => {
	const taskId = args.task_id as string;
	const enabled = args.enabled as boolean | undefined;
	const intervalMinutes = args.interval_minutes as number | undefined;
	const description = args.description as string | undefined;
	const prompt = args.prompt as string | undefined;

	if (!taskId) return fail("task_id is required");

	const heartbeat = loadHeartbeat();
	const task = heartbeat.tasks.find((t) => t.id === taskId);

	if (!task) return fail(`タスク "${taskId}" が見つかりません`);

	// バリデーションを全て先に行い、変更適用は後にまとめる
	if (task.type === "builtin" && prompt !== undefined) {
		return fail("ビルトインタスクの prompt は変更できません");
	}

	if (intervalMinutes !== undefined) {
		const minInterval =
			task.type === "custom" ? CUSTOM_MIN_INTERVAL : getMinInterval(task.id);
		if (intervalMinutes < minInterval || intervalMinutes > MAX_INTERVAL) {
			return fail(
				`interval_minutes は ${minInterval}〜${MAX_INTERVAL} の範囲で指定してください`,
			);
		}
	}

	if (prompt !== undefined && prompt.length > MAX_PROMPT_LENGTH) {
		return fail(`prompt は ${MAX_PROMPT_LENGTH} 文字以内にしてください`);
	}

	// バリデーション通過後に変更を適用
	const changes: string[] = [];

	if (enabled !== undefined && enabled !== task.enabled) {
		task.enabled = enabled;
		changes.push(`enabled → ${enabled}`);
	}

	if (
		intervalMinutes !== undefined &&
		intervalMinutes !== task.interval_minutes
	) {
		task.interval_minutes = intervalMinutes;
		changes.push(`interval_minutes → ${intervalMinutes}`);
	}

	if (description !== undefined && description !== task.description) {
		task.description = description;
		changes.push(`description → ${description}`);
	}

	if (prompt !== undefined && prompt !== task.prompt) {
		task.prompt = prompt;
		changes.push(
			`prompt → ${prompt.slice(0, 50)}${prompt.length > 50 ? "…" : ""}`,
		);
	}

	if (changes.length === 0) return ok("変更はありません（既に同じ設定です）。");

	saveHeartbeat(heartbeat);
	return ok(`タスク "${taskId}" を更新: ${changes.join(", ")}`);
};

const createTaskHandler: ToolHandler = async (args) => {
	const taskId = args.task_id as string;
	const description = args.description as string;
	const prompt = args.prompt as string;
	const intervalMinutes = args.interval_minutes as number;

	if (!taskId || !description || !prompt || !intervalMinutes) {
		return fail(
			"task_id, description, prompt, interval_minutes は全て必須です",
		);
	}

	if (!TASK_ID_PATTERN.test(taskId)) {
		return fail(
			"task_id は小文字英字で始まり、小文字英数字とアンダースコアのみ、2〜31文字で指定してください",
		);
	}

	if (BUILTIN_TASK_IDS.has(taskId)) {
		return fail(
			`"${taskId}" はビルトインタスクの ID です。別の ID を使ってください`,
		);
	}

	if (prompt.length > MAX_PROMPT_LENGTH) {
		return fail(`prompt は ${MAX_PROMPT_LENGTH} 文字以内にしてください`);
	}

	if (intervalMinutes < CUSTOM_MIN_INTERVAL || intervalMinutes > MAX_INTERVAL) {
		return fail(
			`interval_minutes は ${CUSTOM_MIN_INTERVAL}〜${MAX_INTERVAL} の範囲で指定してください`,
		);
	}

	const heartbeat = loadHeartbeat();

	if (heartbeat.tasks.find((t) => t.id === taskId)) {
		return fail(`タスク "${taskId}" は既に存在します`);
	}

	const customCount = heartbeat.tasks.filter((t) => t.type === "custom").length;
	if (customCount >= MAX_CUSTOM_TASKS) {
		return fail(
			`カスタムタスクは最大 ${MAX_CUSTOM_TASKS} 個までです（現在 ${customCount} 個）`,
		);
	}

	heartbeat.tasks.push({
		id: taskId,
		description,
		interval_minutes: intervalMinutes,
		enabled: true,
		type: "custom",
		prompt,
		require_active_hours: true,
	});

	saveHeartbeat(heartbeat);
	return ok(
		`カスタムタスク "${taskId}" を作成しました: ${description} (間隔: ${intervalMinutes}分)`,
	);
};

const deleteTaskHandler: ToolHandler = async (args) => {
	const taskId = args.task_id as string;

	if (!taskId) return fail("task_id is required");

	const heartbeat = loadHeartbeat();
	const taskIndex = heartbeat.tasks.findIndex((t) => t.id === taskId);

	if (taskIndex === -1) return fail(`タスク "${taskId}" が見つかりません`);

	const task = heartbeat.tasks[taskIndex];
	if (!task) return fail(`タスク "${taskId}" が見つかりません`);

	if (task.type === "builtin") {
		return fail(
			"ビルトインタスクは削除できません。enabled=false で無効化してください",
		);
	}

	heartbeat.tasks.splice(taskIndex, 1);
	saveHeartbeat(heartbeat);
	return ok(`カスタムタスク "${taskId}" を削除しました`);
};

export const heartbeatTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "list_tasks",
				description: "全定期タスク（ビルトイン＋カスタム）の一覧を確認する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: listTasksHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "update_task",
				description:
					"定期タスクの設定を変更する（有効/無効・間隔・説明・プロンプト）",
				parameters: {
					type: "object",
					properties: {
						task_id: {
							type: "string",
							description: "変更するタスクの ID",
						},
						enabled: {
							type: "boolean",
							description: "タスクを有効/無効にする",
						},
						interval_minutes: {
							type: "number",
							description:
								"タスクの実行間隔（分）。ビルトインタスクは種別ごとに下限あり",
						},
						description: {
							type: "string",
							description: "タスクの説明を変更する",
						},
						prompt: {
							type: "string",
							description:
								"カスタムタスクの実行プロンプトを変更する（ビルトインタスクでは変更不可）",
						},
					},
					required: ["task_id"],
				},
			},
		},
		handler: updateTaskHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "create_task",
				description:
					"新しいカスタム定期タスクを作成する。最大5個まで。指定したプロンプトに従って定期的にエージェントループが実行される",
				parameters: {
					type: "object",
					properties: {
						task_id: {
							type: "string",
							description:
								"タスクの一意な ID（小文字英字開始、小文字英数字+アンダースコア、2〜31文字）",
						},
						description: {
							type: "string",
							description: "タスクの説明",
						},
						prompt: {
							type: "string",
							description:
								"タスク実行時のプロンプト（500文字以内）。エージェントループがこのプロンプトに従って行動する",
						},
						interval_minutes: {
							type: "number",
							description: "実行間隔（分）。60〜10080の範囲（1時間〜1週間）",
						},
					},
					required: ["task_id", "description", "prompt", "interval_minutes"],
				},
			},
		},
		handler: createTaskHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "delete_task",
				description:
					"カスタムタスクを削除する。ビルトインタスクは削除不可（enabled=false で無効化可能）",
				parameters: {
					type: "object",
					properties: {
						task_id: {
							type: "string",
							description: "削除するカスタムタスクの ID",
						},
					},
					required: ["task_id"],
				},
			},
		},
		handler: deleteTaskHandler,
	},
];
