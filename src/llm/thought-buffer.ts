import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { thoughtBufferPath } from "../data/paths.ts";
import type { ThoughtFragment, ThoughtType } from "../pipeline/types.ts";

const MAX_THOUGHTS = 30;

interface ThoughtBufferData {
	thoughts: ThoughtFragment[];
	last_updated: string;
}

let _idCounter = 0;

function generateId(): string {
	_idCounter++;
	return `t_${Date.now()}_${_idCounter}`;
}

export function loadThoughtBuffer(): ThoughtFragment[] {
	const path = thoughtBufferPath();
	try {
		if (!existsSync(path)) return [];
		const raw = readFileSync(path, "utf-8");
		const data = JSON.parse(raw) as ThoughtBufferData;
		return data.thoughts ?? [];
	} catch {
		return [];
	}
}

function saveThoughtBuffer(thoughts: ThoughtFragment[]): void {
	const path = thoughtBufferPath();
	const data: ThoughtBufferData = {
		thoughts,
		last_updated: new Date().toISOString(),
	};
	writeFileSync(path, JSON.stringify(data, null, "\t"), "utf-8");
}

export function appendThought(
	content: string,
	type: ThoughtType,
	source: string,
	intensity: number,
	relatedGoalId?: string,
): void {
	const thoughts = loadThoughtBuffer();
	const fragment: ThoughtFragment = {
		id: generateId(),
		content,
		type,
		source,
		timestamp: new Date().toISOString(),
		intensity: Math.max(0, Math.min(1, intensity)),
		relatedGoalId,
	};
	thoughts.push(fragment);

	// 古いものから削除
	if (thoughts.length > MAX_THOUGHTS) {
		thoughts.splice(0, thoughts.length - MAX_THOUGHTS);
	}

	saveThoughtBuffer(thoughts);
	console.log(
		`[thought-buffer] Added (${type}, intensity=${intensity.toFixed(2)}): ${content}`,
	);
}

export function consumeThoughts(ids: string[]): void {
	if (ids.length === 0) return;
	const idSet = new Set(ids);
	const thoughts = loadThoughtBuffer().filter((t) => !idSet.has(t.id));
	saveThoughtBuffer(thoughts);
	console.log(`[thought-buffer] Consumed ${ids.length} thoughts`);
}

export function getRecentThoughts(limit = 10): ThoughtFragment[] {
	const thoughts = loadThoughtBuffer();
	return thoughts.slice(-limit);
}
