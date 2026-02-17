import cron from "node-cron";
import { autonomousPost } from "./cron.ts";

export function startScheduler(): void {
	// 30分ごとに自主発言の判定を行う
	cron.schedule("*/30 * * * *", () => {
		console.log("[scheduler] Running autonomous post check...");
		autonomousPost().catch((err) => {
			console.error("[scheduler] Error in autonomous post:", err);
		});
	});

	console.log("[scheduler] Started (every 30 min)");
}
