import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HeartbeatTask {
	id: string;
	description: string;
	interval_minutes: number;
	last_executed?: string;
	enabled: boolean;
}

export interface ActiveHours {
	start: number; // 開始時 (0-23)
	end: number; // 終了時 (24を超えると翌日扱い。例: 26 = 翌2時)
}

export interface Heartbeat {
	tasks: HeartbeatTask[];
	active_hours?: ActiveHours;
	last_run: string;
}

/**
 * 現在時刻がアクティブ時間帯内かどうかを判定する
 * JST (Asia/Tokyo) 基準
 */
export function isWithinActiveHours(heartbeat: Heartbeat): boolean {
	if (!heartbeat.active_hours) return true;

	const { start, end } = heartbeat.active_hours;
	const now = new Date();
	const jstHour =
		now.getUTCHours() + 9 + now.getUTCMinutes() / 60;
	const normalizedHour = jstHour >= 24 ? jstHour - 24 : jstHour;

	if (end <= 24) {
		// 同日内: start <= now < end
		return normalizedHour >= start && normalizedHour < end;
	}

	// 日跨ぎ: start <= now || now < (end - 24)
	const endNormalized = end - 24;
	return normalizedHour >= start || normalizedHour < endNormalized;
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
