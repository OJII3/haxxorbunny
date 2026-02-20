import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentContext } from "../agent/types.ts";
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
	triggered_by: AgentContext["triggeredBy"];
}

export interface AvatarState {
	current_avatar_id: string | null;
	last_changed_at: string | null;
	history: AvatarHistoryEntry[];
}

const MAX_HISTORY = 20;
const COOLDOWN_MS = 30 * 60 * 1000; // 30分

function isValidAvatarEntry(entry: unknown): entry is AvatarEntry {
	if (typeof entry !== "object" || entry === null) return false;
	const e = entry as Record<string, unknown>;
	return (
		typeof e.id === "string" &&
		typeof e.filename === "string" &&
		typeof e.name === "string" &&
		typeof e.description === "string" &&
		Array.isArray(e.tags) &&
		e.tags.every((t: unknown) => typeof t === "string")
	);
}

export function loadManifest(): AvatarManifest {
	try {
		const raw = readFileSync(avatarManifestPath(), "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (!Array.isArray(parsed.avatars)) return { avatars: [] };
		const avatars = parsed.avatars.filter(isValidAvatarEntry);
		return { avatars };
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

export function getCooldownRemainingFromState(state: AvatarState): number {
	if (!state.last_changed_at) return 0;
	const elapsed = Date.now() - new Date(state.last_changed_at).getTime();
	return Math.max(0, COOLDOWN_MS - elapsed);
}

export function isOnCooldownFromState(state: AvatarState): boolean {
	return getCooldownRemainingFromState(state) > 0;
}

/** filename がアバターディレクトリ外を参照していないか検証 */
function isSafeFilename(filename: string): boolean {
	const resolved = resolve(avatarDir(), filename);
	return resolved.startsWith(`${avatarDir()}/`);
}

export function getAvatarImagePath(filename: string): string | null {
	if (!isSafeFilename(filename)) return null;
	return join(avatarDir(), filename);
}

export function avatarImageExists(filename: string): boolean {
	const path = getAvatarImagePath(filename);
	return path !== null && existsSync(path);
}

export function recordChange(
	avatarId: string,
	reason: string,
	triggeredBy: AgentContext["triggeredBy"],
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
