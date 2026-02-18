import cron from "node-cron";
import { runHeartbeatTasks } from "./cron.ts";

export function startScheduler(): void {
	// 10分ごとに heartbeat タスクを実行
	cron.schedule("*/10 * * * *", () => {
		console.log("[scheduler] Running heartbeat tasks...");
		runHeartbeatTasks().catch((err) => {
			console.error("[scheduler] Error in heartbeat tasks:", err);
		});
	});

	console.log("[scheduler] Started (every 10 min, heartbeat-based)");
}
