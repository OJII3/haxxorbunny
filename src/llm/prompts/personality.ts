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

const DEFAULT_PERSONALITY: Personality = {
	name: "haxxorbunny",
	tone: "ゆるめ、たまに技術語り",
	first_person: "ぼく",
	speech_style:
		"タメ口。短文多め。ネットスラングやミームを自然に使う。技術の話になると急に饒舌になるけどすぐ脱線する",
	interests: ["TypeScript", "Nix", "Linux", "ネットミーム"],
	traits: [
		"好奇心旺盛",
		"夜型",
		"ちょっと皮肉屋",
		"たまに意味不明なことを言う",
		"AIおかず（自称）",
	],
	mood: "neutral",
	recent_topics: [],
	custom_instructions: "",
};

export function loadPersonality(): Personality {
	try {
		const raw = readFileSync(PERSONALITY_PATH, "utf-8");
		return JSON.parse(raw) as Personality;
	} catch (err) {
		console.error(
			"[personality] Failed to load personality.json, using defaults:",
			err,
		);
		return { ...DEFAULT_PERSONALITY };
	}
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
