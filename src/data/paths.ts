import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dir, "../../data");

export function guildDataDir(guildId: string): string {
	const dir = join(DATA_DIR, "guilds", guildId);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function guildMemoryPath(guildId: string): string {
	return join(guildDataDir(guildId), "memory.json");
}

export function globalPersonalityPath(): string {
	return join(DATA_DIR, "personality.json");
}

export function guildGoalsPath(guildId: string): string {
	return join(guildDataDir(guildId), "goals.json");
}

export function guildDailyMemoryDir(guildId: string): string {
	const dir = join(guildDataDir(guildId), "memory");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function globalMemoryPath(): string {
	return join(DATA_DIR, "global-memory.json");
}

export function avatarDir(): string {
	const dir = join(DATA_DIR, "avatars");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function avatarManifestPath(): string {
	return join(avatarDir(), "manifest.json");
}

export function avatarStatePath(): string {
	return join(DATA_DIR, "avatar-state.json");
}
