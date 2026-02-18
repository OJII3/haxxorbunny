import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HeartbeatTask {
	id: string;
	description: string;
	interval_minutes: number;
	last_executed?: string;
	enabled: boolean;
}

export interface Heartbeat {
	tasks: HeartbeatTask[];
	last_run: string;
}

const HEARTBEAT_PATH = join(import.meta.dir, "../../data/heartbeat.json");

export function loadHeartbeat(): Heartbeat {
	try {
		const raw = readFileSync(HEARTBEAT_PATH, "utf-8");
		return JSON.parse(raw) as Heartbeat;
	} catch {
		const defaultHeartbeat: Heartbeat = {
			tasks: [],
			last_run: "",
		};
		return defaultHeartbeat;
	}
}

export function saveHeartbeat(heartbeat: Heartbeat): void {
	heartbeat.last_run = new Date().toISOString();
	writeFileSync(HEARTBEAT_PATH, JSON.stringify(heartbeat, null, "\t"), "utf-8");
}

export function shouldRunTask(task: HeartbeatTask): boolean {
	if (!task.enabled) return false;
	if (!task.last_executed) return true;

	const lastRun = new Date(task.last_executed).getTime();
	const now = Date.now();
	const elapsedMs = now - lastRun;
	const marginMs = 60 * 1000; // 1分のマージン (cron実行タイミングのずれ対策)
	return elapsedMs >= task.interval_minutes * 60 * 1000 - marginMs;
}

export function markTaskExecuted(heartbeat: Heartbeat, taskId: string): void {
	const task = heartbeat.tasks.find((t) => t.id === taskId);
	if (task) {
		task.last_executed = new Date().toISOString();
		saveHeartbeat(heartbeat);
	}
}
