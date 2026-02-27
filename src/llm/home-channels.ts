import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guildDataDir } from "../data/paths.ts";

export interface HomeChannelsData {
	channel_ids: string[];
	last_updated: string;
}

function homeChannelsPath(guildId: string): string {
	return join(guildDataDir(guildId), "home-channels.json");
}

export function loadHomeChannels(guildId: string): HomeChannelsData {
	const path = homeChannelsPath(guildId);
	if (!existsSync(path)) {
		return { channel_ids: [], last_updated: "" };
	}
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as HomeChannelsData;
	} catch {
		console.warn("[home-channels] Failed to parse, returning empty");
		return { channel_ids: [], last_updated: "" };
	}
}

export function saveHomeChannels(
	guildId: string,
	data: HomeChannelsData,
): void {
	const path = homeChannelsPath(guildId);
	data.last_updated = new Date().toISOString();
	writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * ホームチャンネル判定。
 * channel_ids が空（未設定）なら全チャンネルがホーム扱い（後方互換）。
 */
export function isHomeChannel(guildId: string, channelId: string): boolean {
	const data = loadHomeChannels(guildId);
	if (data.channel_ids.length === 0) return true;
	return data.channel_ids.includes(channelId);
}
