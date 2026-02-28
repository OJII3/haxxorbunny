import { config } from "../config.ts";
import { appendMemoryEntry } from "../llm/memory.ts";
import type { MoodState, Personality } from "../llm/prompts/personality.ts";
import { updatePersonality } from "../llm/prompts/personality.ts";
import { appendThought } from "../llm/thought-buffer.ts";
import { triageLlm } from "../llm/triage-client.ts";
import { PIPELINE_REFLECTION_SYSTEM_PROMPT } from "./prompts/reflection.ts";
import type {
	ExecutionLog,
	ExtendedTriageResult,
	PerceptionResult,
	ThoughtType,
} from "./types.ts";

interface PipelineReflectionResult {
	personality_update?: {
		mood?: Partial<MoodState>;
		recent_topics?: string[];
		interests?: string[];
	} | null;
	memory_entry?: string | null;
	thought?: {
		content: string;
		type: ThoughtType;
		intensity: number;
	} | null;
	reasoning: string;
}

/**
 * Phase 5: 振り返り
 * fire-and-forget で personality/memory/thought buffer を更新
 */
export async function pipelineReflect(
	guildId: string,
	perception: PerceptionResult,
	triage: ExtendedTriageResult,
	executionLog: ExecutionLog | null,
	mood: MoodState,
	source: string,
): Promise<void> {
	const actionSummary = executionLog
		? executionLog.actions
				.map((a) => `${a.type}: ${a.success ? "OK" : "FAIL"}`)
				.join(", ")
		: "none";

	const context = `
## 対象メッセージ
[${perception.author}]: ${perception.content}

## トリアージ結果
action: ${triage.action}, intent: ${triage.intent}, emotional_note: ${triage.emotional_note}

## 実行結果
${actionSummary}

## 現在の気分
energy=${mood.energy.toFixed(2)}, positivity=${mood.positivity.toFixed(2)}, sociability=${mood.sociability.toFixed(2)}, curiosity=${mood.curiosity.toFixed(2)}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: PIPELINE_REFLECTION_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.3,
			max_tokens: 2048,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[pipeline/reflection] Empty response");
			return;
		}

		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("[pipeline/reflection] No JSON found:", raw);
			return;
		}

		let result: PipelineReflectionResult;
		try {
			result = JSON.parse(jsonMatch[0]) as PipelineReflectionResult;
		} catch {
			console.warn(
				"[pipeline/reflection] Failed to parse JSON:",
				jsonMatch[0].slice(0, 200),
			);
			return;
		}

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
			console.log("[pipeline/reflection/personality] Updated:", update);
		}

		if (result.memory_entry) {
			appendMemoryEntry(guildId, result.memory_entry, 2);
			console.log("[pipeline/reflection/memory] Added:", result.memory_entry);
		}

		if (result.thought) {
			appendThought(
				result.thought.content,
				result.thought.type,
				source,
				result.thought.intensity,
			);
		}

		console.log(
			`[pipeline/reflection] ${source} | reason: ${result.reasoning}`,
		);
	} catch (error) {
		console.error("[pipeline/reflection] Error:", error);
	}
}
