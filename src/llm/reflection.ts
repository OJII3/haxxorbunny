import { config } from "../config.ts";
import { appendMemoryEntry } from "./memory.ts";
import { type Personality, updatePersonality } from "./prompts/personality.ts";
import { triageLlm } from "./triage-client.ts";

interface ReflectionResult {
	personality_update?: Partial<
		Pick<Personality, "mood" | "recent_topics" | "interests">
	> | null;
	memory_entry?: string | null;
	reasoning: string;
}

const REFLECTION_SYSTEM_PROMPT = `
あなたは Discord bot "haxxorbunny" の内省エンジンです。
会話を観察して、以下の2点だけを判定してください:

1. 気分(mood)・最近の話題(recent_topics)・興味(interests)に微調整が必要か
2. 何か記憶に残すべきことがあるか（30字以内のメモ）

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "personality_update": null | { "mood": "...", "recent_topics": [...], "interests": [...] },
  "memory_entry": null | "覚えておきたいこと（30字以内）",
  "reasoning": "判定理由（短く）"
}

注意:
- personality_update で変更できるのは mood, recent_topics, interests のみ
- personality_update は変更したいフィールドのみ含めてください
- 大きな変更は不要。微調整のみ
- 記憶は本当に重要なことだけ（ユーザーの好み、重要な出来事など）
- 大半のメッセージでは null を返してOK
`.trim();

export async function reflect(
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
			max_tokens: 512,
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

		const result = JSON.parse(jsonMatch[0]) as ReflectionResult;

		if (result.personality_update) {
			updatePersonality(result.personality_update);
			console.log(
				"[reflection/personality] Updated:",
				result.personality_update,
			);
		}

		if (result.memory_entry) {
			appendMemoryEntry(result.memory_entry);
			console.log("[reflection/memory] Added:", result.memory_entry);
		}

		console.log(`[reflection] ${channelId} | reason: ${result.reasoning}`);
	} catch (error) {
		console.error("[reflection] Error:", error);
	}
}
