import cron from "node-cron";
import { runFrequentTasks, runInfrequentTasks } from "./cron.ts";

export function startScheduler(): void {
	// 13分ごとに高頻度タスクを実行（autonomous_post, channel_patrol, goal_check）
	cron.schedule("*/13 * * * *", () => {
		console.log("[scheduler] Running frequent tasks...");
		runFrequentTasks().catch((err) => {
			console.error("[scheduler] Error in frequent tasks:", err);
		});
	});

	// 2時間ごとに低頻度タスクを実行（distill_memory, cleanup_old_memory, dream_processing）
	cron.schedule("0 */2 * * *", () => {
		console.log("[scheduler] Running infrequent tasks...");
		runInfrequentTasks().catch((err) => {
			console.error("[scheduler] Error in infrequent tasks:", err);
		});
	});

	console.log(
		"[scheduler] Started (frequent: every 13 min, infrequent: every 2 hours)",
	);
}
