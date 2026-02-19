import cron from "node-cron";
import { runFrequentTasks, runInfrequentTasks } from "./cron.ts";

export function startScheduler(): void {
	// 3分ごとに高頻度タスクを実行（autonomous_post, channel_patrol, goal_check）
	cron.schedule("*/3 * * * *", () => {
		console.log("[scheduler] Running frequent tasks...");
		runFrequentTasks().catch((err) => {
			console.error("[scheduler] Error in frequent tasks:", err);
		});
	});

	// 30分ごとに低頻度タスクを実行（distill_memory, cleanup_old_memory, dream_processing）
	cron.schedule("*/30 * * * *", () => {
		console.log("[scheduler] Running infrequent tasks...");
		runInfrequentTasks().catch((err) => {
			console.error("[scheduler] Error in infrequent tasks:", err);
		});
	});

	console.log(
		"[scheduler] Started (frequent: every 3 min, infrequent: every 30 min)",
	);
}
