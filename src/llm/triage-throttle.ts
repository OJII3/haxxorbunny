import { config } from "../config.ts";

const lastTriageTimestamps = new Map<string, number>();

export function shouldThrottle(channelId: string): boolean {
	const now = Date.now();
	const last = lastTriageTimestamps.get(channelId);
	if (last && now - last < config.triage.throttleMs) {
		return true;
	}
	lastTriageTimestamps.set(channelId, now);
	return false;
}
