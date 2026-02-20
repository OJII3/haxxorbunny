import { loadHeartbeat, saveHeartbeat } from "../../llm/heartbeat.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const AUTONOMOUS_POST_ID = "autonomous_post";
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 1440;

const getPostingScheduleHandler: ToolHandler = async () => {
	const heartbeat = loadHeartbeat();
	const task = heartbeat.tasks.find((t) => t.id === AUTONOMOUS_POST_ID);

	if (!task) return fail("autonomous_post task not found in heartbeat.json");

	return ok(
		`独り言スケジュール: enabled=${task.enabled}, interval_minutes=${task.interval_minutes}, last_executed=${task.last_executed ?? "never"}`,
	);
};

const updatePostingScheduleHandler: ToolHandler = async (args) => {
	const enabled = args.enabled as boolean | undefined;
	const intervalMinutes = args.interval_minutes as number | undefined;

	if (enabled === undefined && intervalMinutes === undefined) {
		return fail("enabled or interval_minutes is required");
	}

	if (
		intervalMinutes !== undefined &&
		(intervalMinutes < MIN_INTERVAL || intervalMinutes > MAX_INTERVAL)
	) {
		return fail(
			`interval_minutes must be between ${MIN_INTERVAL} and ${MAX_INTERVAL}`,
		);
	}

	const heartbeat = loadHeartbeat();
	const task = heartbeat.tasks.find((t) => t.id === AUTONOMOUS_POST_ID);

	if (!task) return fail("autonomous_post task not found in heartbeat.json");

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

	if (changes.length === 0) return ok("No changes needed (already set).");

	saveHeartbeat(heartbeat);
	return ok(`独り言スケジュールを更新: ${changes.join(", ")}`);
};

export const heartbeatTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "get_posting_schedule",
				description: "独り言（自主発言）の現在のスケジュール設定を確認する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: getPostingScheduleHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "update_posting_schedule",
				description:
					"独り言（自主発言）の頻度を変更する。気分や状況に応じて調整できる",
				parameters: {
					type: "object",
					properties: {
						enabled: {
							type: "boolean",
							description: "独り言を有効/無効にする",
						},
						interval_minutes: {
							type: "number",
							description: "独り言の間隔（分）。15〜1440の範囲",
						},
					},
				},
			},
		},
		handler: updatePostingScheduleHandler,
	},
];
