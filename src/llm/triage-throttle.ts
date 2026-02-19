import { config } from "../config.ts";

const lastTriageTimestamps = new Map<string, number>();
const channelAgentLocks = new Map<string, boolean>();
const lastResponseTimestamps = new Map<string, number>();

export function lockChannel(channelId: string): void {
	channelAgentLocks.set(channelId, true);
}

export function unlockChannel(channelId: string): void {
	channelAgentLocks.delete(channelId);
}

export function markChannelResponded(channelId: string): void {
	lastResponseTimestamps.set(channelId, Date.now());
}

/**
 * トリアージをスキップすべきか判定する統合ガード関数。
 *
 * 優先順位:
 * 1. チャンネルロック中 → メンションでもスキップ（ループ実行中は重複防止最優先）
 * 2. 応答後クールダウン → メンション時 5秒 / 通常 15秒
 * 3. トリアージスロットル → メンション時バイパス / 通常 10秒
 */
export function shouldSkipTriage(
	channelId: string,
	hasMention: boolean,
): boolean {
	const now = Date.now();

	// 1. チャンネルロック中（エージェントループ実行中）
	if (channelAgentLocks.get(channelId)) {
		console.log(
			`[throttle] channel ${channelId} locked (agent running), skipping`,
		);
		return true;
	}

	// 2. 応答後クールダウン
	const lastResponse = lastResponseTimestamps.get(channelId);
	if (lastResponse) {
		const cooldown = hasMention
			? config.triage.responseCooldownMentionMs
			: config.triage.responseCooldownMs;
		if (now - lastResponse < cooldown) {
			console.log(
				`[throttle] channel ${channelId} in response cooldown (${cooldown}ms), skipping`,
			);
			return true;
		}
	}

	// 3. トリアージスロットル（メンション時はバイパス）
	if (!hasMention) {
		const lastTriage = lastTriageTimestamps.get(channelId);
		if (lastTriage && now - lastTriage < config.triage.throttleMs) {
			return true;
		}
	}

	lastTriageTimestamps.set(channelId, now);
	return false;
}
