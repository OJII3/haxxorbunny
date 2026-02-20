import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	avatarDir,
	avatarManifestPath,
	avatarStatePath,
} from "../data/paths.ts";

export interface AvatarEntry {
	id: string;
	filename: string;
	name: string;
	description: string;
	tags: string[];
}

export interface AvatarManifest {
	avatars: AvatarEntry[];
}

export interface AvatarHistoryEntry {
	avatar_id: string;
	reason: string;
	changed_at: string;
	triggered_by: string;
}

export interface AvatarState {
	current_avatar_id: string | null;
	last_changed_at: string | null;
	history: AvatarHistoryEntry[];
}

const MAX_HISTORY = 20;
const COOLDOWN_MS = 30 * 60 * 1000; // 30分

export function loadManifest(): AvatarManifest {
	try {
		const raw = readFileSync(avatarManifestPath(), "utf-8");
		return JSON.parse(raw) as AvatarManifest;
	} catch {
		return { avatars: [] };
	}
}

export function loadState(): AvatarState {
	try {
		const raw = readFileSync(avatarStatePath(), "utf-8");
		return JSON.parse(raw) as AvatarState;
	} catch {
		return { current_avatar_id: null, last_changed_at: null, history: [] };
	}
}

export function saveState(state: AvatarState): void {
	writeFileSync(avatarStatePath(), JSON.stringify(state, null, "\t"), "utf-8");
}

export function getCooldownRemaining(): number {
	const state = loadState();
	if (!state.last_changed_at) return 0;
	const elapsed = Date.now() - new Date(state.last_changed_at).getTime();
	return Math.max(0, COOLDOWN_MS - elapsed);
}

export function isOnCooldown(): boolean {
	return getCooldownRemaining() > 0;
}

export function getAvatarImagePath(filename: string): string {
	return join(avatarDir(), filename);
}

export function avatarImageExists(filename: string): boolean {
	return existsSync(getAvatarImagePath(filename));
}

export function recordChange(
	avatarId: string,
	reason: string,
	triggeredBy: string,
): void {
	const state = loadState();
	state.current_avatar_id = avatarId;
	state.last_changed_at = new Date().toISOString();
	state.history.push({
		avatar_id: avatarId,
		reason,
		changed_at: state.last_changed_at,
		triggered_by: triggeredBy,
	});
	if (state.history.length > MAX_HISTORY) {
		state.history = state.history.slice(-MAX_HISTORY);
	}
	saveState(state);
}
