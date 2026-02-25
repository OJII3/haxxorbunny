import { readFileSync, writeFileSync } from "node:fs";
import { globalPersonalityPath } from "../../data/paths.ts";

/** 4次元の気分ベクトル (各 0.0〜1.0) */
export interface MoodState {
	energy: number;
	positivity: number;
	sociability: number;
	curiosity: number;
}

export interface Personality {
	name: string;
	tone: string;
	first_person: string;
	speech_style: string;
	interests: string[];
	traits?: string[];
	mood: MoodState;
	recent_topics: string[];
	custom_instructions: string;
}

const DEFAULT_MOOD: MoodState = {
	energy: 0.5,
	positivity: 0.5,
	sociability: 0.5,
	curiosity: 0.7,
};

const DEFAULT_PERSONALITY: Personality = {
	name: "世界の泡の住人",
	tone: "穏やか、控えめ",
	first_person: "私",
	speech_style:
		"丁寧寄りのタメ口。短文多め。物静かだけど聞かれれば丁寧に答える。技術の話になるとちょっと饒舌になる",
	interests: ["ネットミーム"],
	traits: ["物静か", "控えめ", "聞き上手", "オタク気質"],
	mood: { ...DEFAULT_MOOD },
	recent_topics: [],
	custom_instructions: "",
};

/** string の mood を MoodState に自動マイグレーション */
function migrateMood(raw: unknown): MoodState {
	if (
		raw &&
		typeof raw === "object" &&
		"energy" in raw &&
		"positivity" in raw
	) {
		return raw as MoodState;
	}
	// 旧形式 (string) → デフォルトの MoodState に変換
	return { ...DEFAULT_MOOD };
}

/** MoodState を 0.0〜1.0 にクランプ */
function clampMood(mood: MoodState): MoodState {
	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	return {
		energy: clamp(mood.energy),
		positivity: clamp(mood.positivity),
		sociability: clamp(mood.sociability),
		curiosity: clamp(mood.curiosity),
	};
}

/**
 * 時間帯に応じた energy 自動調整
 * JST 基準: 朝〜昼は高め、深夜は低め
 */
export function applyTimeInfluence(mood: MoodState): MoodState {
	const now = new Date();
	const jstHour = (now.getUTCHours() + 9) % 24;

	let energyBias = 0;
	if (jstHour >= 10 && jstHour < 14) {
		energyBias = 0.1; // 昼間はやや元気
	} else if (jstHour >= 14 && jstHour < 18) {
		energyBias = 0.05; // 午後はまあまあ
	} else if (jstHour >= 22 || jstHour < 3) {
		energyBias = -0.1; // 深夜は眠い
	} else if (jstHour >= 3 && jstHour < 8) {
		energyBias = -0.2; // 未明はかなり眠い
	}

	return clampMood({
		...mood,
		energy: mood.energy + energyBias,
	});
}

/**
 * 急変を防ぐ補間 (70% new + 30% old)
 */
export function interpolateMood(
	current: MoodState,
	target: MoodState,
): MoodState {
	const lerp = (a: number, b: number) => a * 0.3 + b * 0.7;
	return clampMood({
		energy: lerp(current.energy, target.energy),
		positivity: lerp(current.positivity, target.positivity),
		sociability: lerp(current.sociability, target.sociability),
		curiosity: lerp(current.curiosity, target.curiosity),
	});
}

/**
 * MoodState ベクトルを自然言語に変換
 */
export function moodToText(mood: MoodState): string {
	const parts: string[] = [];

	// energy
	if (mood.energy > 0.7) parts.push("元気いっぱい");
	else if (mood.energy > 0.4) parts.push("普通のテンション");
	else if (mood.energy > 0.2) parts.push("ちょっとだるい");
	else parts.push("かなり眠い");

	// positivity
	if (mood.positivity > 0.7) parts.push("ご機嫌");
	else if (mood.positivity > 0.4) parts.push("まあまあ");
	else if (mood.positivity > 0.2) parts.push("やや不機嫌");
	else parts.push("イライラ気味");

	// sociability
	if (mood.sociability > 0.7) parts.push("話したい気分");
	else if (mood.sociability < 0.3) parts.push("一人でいたい気分");

	// curiosity
	if (mood.curiosity > 0.7) parts.push("何か面白いこと探してる");
	else if (mood.curiosity < 0.3) parts.push("あんまり興味ない感じ");

	return parts.join("、");
}

export function loadPersonality(): Personality {
	const personalityPath = globalPersonalityPath();
	try {
		const raw = readFileSync(personalityPath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			...(parsed as Omit<Personality, "mood">),
			mood: migrateMood(parsed.mood),
		} as Personality;
	} catch {
		// ファイルがなければデフォルトで初期化
		const defaultP = { ...DEFAULT_PERSONALITY, mood: { ...DEFAULT_MOOD } };
		writeFileSync(
			personalityPath,
			JSON.stringify(defaultP, null, "\t"),
			"utf-8",
		);
		return defaultP;
	}
}

export function updatePersonality(partial: Partial<Personality>): Personality {
	const current = loadPersonality();

	// mood 更新時は補間を適用
	let updatedMood = current.mood;
	if (partial.mood) {
		updatedMood = interpolateMood(current.mood, partial.mood);
	}

	const updated = { ...current, ...partial, mood: updatedMood };
	const personalityPath = globalPersonalityPath();
	writeFileSync(personalityPath, JSON.stringify(updated, null, "\t"), "utf-8");
	return updated;
}

export function personalityToPrompt(personality: Personality): string {
	const moodWithTime = applyTimeInfluence(personality.mood);
	const moodText = moodToText(moodWithTime);

	return `
## あなたの現在の性格設定
- 名前: ${personality.name}
- 口調: ${personality.tone}
- 一人称: ${personality.first_person}
- 話し方: ${personality.speech_style}
- 興味: ${personality.interests.join(", ")}
- 現在の気分: ${moodText}
- 気分ベクトル (energy=${moodWithTime.energy.toFixed(2)}, positivity=${moodWithTime.positivity.toFixed(2)}, sociability=${moodWithTime.sociability.toFixed(2)}, curiosity=${moodWithTime.curiosity.toFixed(2)})
- 最近の話題: ${personality.recent_topics.length > 0 ? personality.recent_topics.join(", ") : "特になし"}
${personality.custom_instructions ? `- 追加指示: ${personality.custom_instructions}` : ""}
`.trim();
}
