import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guildDataDir } from "../data/paths.ts";

export interface ChannelPolicy {
	channel_id: string;
	/** bot が設定時に書いた自然言語の説明 */
	original_description: string;
	/** sociability+curiosity 平均値へのオフセット (-1.0 ~ +1.0) */
	avg_offset: number;
	/** false なら react → ignore にダウングレード */
	allow_react: boolean;
	/** トリアージプロンプトに注入するテキスト */
	custom_instructions: string;
	last_updated: string;
}

export interface ChannelPoliciesData {
	policies: ChannelPolicy[];
	last_updated: string;
}

/** カスタムポリシー未設定の非ホームチャンネルに適用されるデフォルト */
export const DEFAULT_NON_HOME_POLICY = {
	avg_offset: -0.3,
	allow_react: false,
	custom_instructions: "",
} as const;

function channelPoliciesPath(guildId: string): string {
	return join(guildDataDir(guildId), "channel-policies.json");
}

export function loadChannelPolicies(guildId: string): ChannelPoliciesData {
	const path = channelPoliciesPath(guildId);
	if (!existsSync(path)) {
		return { policies: [], last_updated: "" };
	}
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as ChannelPoliciesData;
	} catch {
		console.warn("[channel-policy] Failed to parse, returning empty");
		return { policies: [], last_updated: "" };
	}
}

export function saveChannelPolicies(
	guildId: string,
	data: ChannelPoliciesData,
): void {
	const path = channelPoliciesPath(guildId);
	data.last_updated = new Date().toISOString();
	writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function getChannelPolicy(
	guildId: string,
	channelId: string,
): ChannelPolicy | null {
	const data = loadChannelPolicies(guildId);
	return data.policies.find((p) => p.channel_id === channelId) ?? null;
}
