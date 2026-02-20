import { config } from "../config.ts";
import { appendMemoryEntry } from "./memory.ts";
import type { MoodState, Personality } from "./prompts/personality.ts";
import { updatePersonality } from "./prompts/personality.ts";
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
			updatePersonality(guildId, update);
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
