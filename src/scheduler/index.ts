import cron from "node-cron";
import { runHeartbeatTasks } from "./cron.ts";

export function startScheduler(): void {
	// 30分ごとに heartbeat タスクを実行
	cron.schedule("*/30 * * * *", () => {
		console.log("[scheduler] Running heartbeat tasks...");
		runHeartbeatTasks().catch((err) => {
			console.error("[scheduler] Error in heartbeat tasks:", err);
		});
	});

	console.log("[scheduler] Started (every 30 min, heartbeat-based)");
}
