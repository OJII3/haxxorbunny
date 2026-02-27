import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HeartbeatTask {
	id: string;
	description: string;
	interval_minutes: number;
	last_executed?: string;
	enabled: boolean;
	/** タスク種別: builtin=コード実装あり, custom=プロンプトで実行 */
	type: "builtin" | "custom";
	/** カスタムタスクの実行プロンプト */
	prompt?: string;
	/** アクティブ時間帯限定か（デフォルト: true） */
	require_active_hours?: boolean;
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
	const jstHour = now.getUTCHours() + 9 + now.getUTCMinutes() / 60;
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
		const heartbeat = JSON.parse(raw) as Heartbeat;
		// フォールバック: type 未設定タスクに "builtin" を自動補完（ファイルには書き戻さず毎回適用）
		for (const task of heartbeat.tasks) {
			if (!task.type) {
				task.type = "builtin";
			}
		}
		return heartbeat;
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
