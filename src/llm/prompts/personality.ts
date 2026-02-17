import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Personality {
	name: string;
	tone: string;
	first_person: string;
	speech_style: string;
	interests: string[];
	traits: string[];
	mood: string;
	recent_topics: string[];
	custom_instructions: string;
}

const PERSONALITY_PATH = join(
	import.meta.dir,
	"../../../data/personality.json",
);

export function loadPersonality(): Personality {
	const raw = readFileSync(PERSONALITY_PATH, "utf-8");
	return JSON.parse(raw) as Personality;
}

export function updatePersonality(partial: Partial<Personality>): Personality {
	const current = loadPersonality();
	const updated = { ...current, ...partial };
	writeFileSync(PERSONALITY_PATH, JSON.stringify(updated, null, 2), "utf-8");
	return updated;
}

export function personalityToPrompt(personality: Personality): string {
	return `
## あなたの現在の性格設定
- 名前: ${personality.name}
- 口調: ${personality.tone}
- 一人称: ${personality.first_person}
- 話し方: ${personality.speech_style}
- 興味: ${personality.interests.join(", ")}
- 特徴: ${personality.traits.join(", ")}
- 現在の気分: ${personality.mood}
- 最近の話題: ${personality.recent_topics.length > 0 ? personality.recent_topics.join(", ") : "特になし"}
${personality.custom_instructions ? `- 追加指示: ${personality.custom_instructions}` : ""}
`.trim();
}
