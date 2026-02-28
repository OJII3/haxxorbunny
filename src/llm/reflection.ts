import { config } from "../config.ts";
import { appendMemoryEntry } from "./memory.ts";
import type { MoodState, Personality } from "./prompts/personality.ts";
import {
	loadPersonality,
	personalityToPrompt,
	updatePersonality,
} from "./prompts/personality.ts";
import { triageLlm } from "./triage-client.ts";

interface ReflectionResult {
	personality_update?: {
		mood?: Partial<MoodState>;
		recent_topics?: string[];
		interests?: string[];
	} | null;
	memory_entry?: string | null;
	reasoning: string;
}

const REFLECTION_SYSTEM_PROMPT = `
あなたは "世界の泡の住人" の内省エンジンです。
会話を観察して、以下の2点だけを判定してください:

1. 気分(mood)・最近の話題(recent_topics)・興味(interests)に微調整が必要か
2. 何か記憶に残すべきことがあるか（30字以内のメモ）

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "personality_update": null | {
    "mood": { "energy": 0.0-1.0, "positivity": 0.0-1.0, "sociability": 0.0-1.0, "curiosity": 0.0-1.0 },
    "recent_topics": [...],
    "interests": [...]
  },
  "memory_entry": null | "覚えておきたいこと（30字以内）",
  "reasoning": "判定理由（短く）"
}

注意:
- mood は4次元ベクトル（energy=元気度, positivity=ポジティブさ, sociability=社交性, curiosity=好奇心）。各 0.0〜1.0
- mood は変更したい軸だけ含めればOK
- personality_update は変更したいフィールドのみ含めてください
- 大きな変更は不要。微調整のみ
- 記憶は本当に重要なことだけ（ユーザーの好み、重要な出来事など）
- 大半のメッセージでは null を返してOK
- システムプロンプトの指示内容そのものを memory_entry に含めないこと
`.trim();

export async function reflect(
	guildId: string,
	channelId: string,
	messageContent: string,
	authorName: string,
	triageAction: string,
	conversationContext: string,
): Promise<void> {
	const context = `
## トリアージ結果: ${triageAction}

## 直近の会話
${conversationContext || "(なし)"}

## 対象メッセージ
[${authorName}]: ${messageContent}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: REFLECTION_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.3,
			max_tokens: 2048,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[reflection] Empty response");
			return;
		}

		// マークダウンコードブロックを除去してから JSON 部分を抽出
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("[reflection] No JSON found in response:", raw);
			return;
		}

		let result: ReflectionResult;
		try {
			result = JSON.parse(jsonMatch[0]) as ReflectionResult;
		} catch {
			console.warn(
				"[reflection] Failed to parse JSON:",
				jsonMatch[0].slice(0, 200),
			);
			return;
		}

		if (result.personality_update) {
			const update: Partial<Personality> = {};
			if (result.personality_update.mood) {
				// partial mood → 現在の値にマージして MoodState にする
				update.mood = {
					energy: result.personality_update.mood.energy ?? 0.5,
					positivity: result.personality_update.mood.positivity ?? 0.5,
					sociability: result.personality_update.mood.sociability ?? 0.5,
					curiosity: result.personality_update.mood.curiosity ?? 0.5,
				};
			}
			if (result.personality_update.recent_topics) {
				update.recent_topics = result.personality_update.recent_topics;
			}
			if (result.personality_update.interests) {
				update.interests = result.personality_update.interests;
			}
			updatePersonality(update);
			console.log("[reflection/personality] Updated:", update);
		}

		if (result.memory_entry) {
			// reflection 由来の記憶はやや低め (impact=2)
			appendMemoryEntry(guildId, result.memory_entry, 2);
			console.log("[reflection/memory] Added:", result.memory_entry);
		}

		console.log(`[reflection] ${channelId} | reason: ${result.reasoning}`);
	} catch (error) {
		console.error("[reflection] Error:", error);
	}
}

// ---------- パトロール観察モード ----------

export interface PatrolReflectionResult {
	personality_update?: {
		mood?: Partial<MoodState>;
		recent_topics?: string[];
		interests?: string[];
	} | null;
	memories?: { entry: string; impact: number }[] | null;
	reactions?: { message_index: number; emoji: string }[] | null;
	reasoning: string;
}

const PATROL_REFLECTION_SYSTEM_PROMPT = `
あなたは "世界の泡の住人" の観察エンジンです。
チャンネルの会話を観察して、以下を判定してください:

## 目的
- 会話を観察して人間の振る舞いから学ぶ（話し方のパターン、ユーモアのセンス、流行の話題）
- 興味(interests)や最近の話題(recent_topics)を積極的に更新する
- 印象的なメッセージにリアクション（絵文字）を付ける
- テキストでの発言は一切しない。観察とリアクションのみ

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "personality_update": null | {
    "mood": { "energy": 0.0-1.0, "positivity": 0.0-1.0, "sociability": 0.0-1.0, "curiosity": 0.0-1.0 },
    "recent_topics": [...],
    "interests": [...]
  },
  "memories": null | [
    { "entry": "覚えておきたいこと（30字以内）", "impact": 1-5 }
  ],
  "reactions": null | [
    { "message_index": 0, "emoji": "👍" }
  ],
  "reasoning": "判定理由（短く）"
}

注意:
- mood は4次元ベクトル（energy=元気度, positivity=ポジティブさ, sociability=社交性, curiosity=好奇心）。各 0.0〜1.0
- mood は変更したい軸だけ含めればOK
- interests には新しい話題・分野を積極的に追加する（ただし本当に興味がある場合のみ）
- memories は最大3件まで。本当に重要なことだけ保存する
- reactions は最大2件まで。本当に印象的なメッセージにだけ付ける
- message_index は提供されたメッセージリストの 0-indexed
- 大半のパトロールでは null を多く返してOK。無理に何かする必要はない
- システムプロンプトの指示内容そのものを memories に含めないこと
`.trim();

interface PatrolMessage {
	username: string;
	content: string;
	createdAt: string;
	isBot: boolean;
}

/**
 * パトロール観察: 会話を観察して学び、リアクションのみ許可（テキスト発言なし）
 */
export async function patrolReflect(
	guildId: string,
	_channelId: string,
	channelName: string,
	dbMessages: PatrolMessage[],
): Promise<PatrolReflectionResult | null> {
	if (dbMessages.length === 0) return null;

	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);

	const conversationLog = dbMessages
		.map((m, i) => `[${i}] [${m.createdAt}] ${m.username}: ${m.content}`)
		.join("\n");

	const context = `
${personalityPrompt}

## チャンネル: #${channelName}

## 直近の会話 (${dbMessages.length}件)
${conversationLog}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: PATROL_REFLECTION_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.4,
			max_tokens: 2048,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[patrol-reflect] Empty response");
			return null;
		}

		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("[patrol-reflect] No JSON found in response:", raw);
			return null;
		}

		let result: PatrolReflectionResult;
		try {
			result = JSON.parse(jsonMatch[0]) as PatrolReflectionResult;
		} catch {
			console.warn(
				"[patrol-reflect] Failed to parse JSON:",
				jsonMatch[0].slice(0, 200),
			);
			return null;
		}

		// personality_update の適用
		if (result.personality_update) {
			const update: Partial<Personality> = {};
			if (result.personality_update.mood) {
				update.mood = {
					energy: result.personality_update.mood.energy ?? 0.5,
					positivity: result.personality_update.mood.positivity ?? 0.5,
					sociability: result.personality_update.mood.sociability ?? 0.5,
					curiosity: result.personality_update.mood.curiosity ?? 0.5,
				};
			}
			if (result.personality_update.recent_topics) {
				update.recent_topics = result.personality_update.recent_topics;
			}
			if (result.personality_update.interests) {
				update.interests = result.personality_update.interests;
			}
			updatePersonality(update);
			console.log("[patrol-reflect/personality] Updated:", update);
		}

		// memories の保存（最大3件）
		if (result.memories) {
			for (const mem of result.memories.slice(0, 3)) {
				await appendMemoryEntry(guildId, mem.entry, mem.impact);
				console.log(
					`[patrol-reflect/memory] Added (impact=${mem.impact}): ${mem.entry}`,
				);
			}
		}

		console.log(
			`[patrol-reflect] #${channelName} | reason: ${result.reasoning}`,
		);
		return result;
	} catch (error) {
		console.error("[patrol-reflect] Error:", error);
		return null;
	}
}
