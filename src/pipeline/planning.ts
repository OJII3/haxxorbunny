import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { config } from "../config.ts";
import {
	type Personality,
	personalityToPrompt,
} from "../llm/prompts/personality.ts";
import { triageLlm } from "../llm/triage-client.ts";
import { parseLlmJson } from "../utils/parse-llm-json.ts";
import { buildPlanningSystemPrompt } from "./prompts/planning.ts";
import type {
	ExtendedTriageResult,
	PerceptionResult,
	PipelineContext,
	PlanResult,
} from "./types.ts";

const DEFAULT_PLAN: PlanResult = {
	actions: ["do_nothing"],
	reply_approach: null,
	reply_as_normal: true,
	react_emoji: null,
	should_memorize: false,
	memo: null,
	memo_impact: 2,
	should_search: false,
	search_query: null,
	categorize_channel_id: null,
	categorize_category: null,
};

/**
 * Phase 2: 計画
 * 「何をするか」を決める
 */
export async function plan(
	triage: ExtendedTriageResult,
	perception: PerceptionResult,
	personality: Personality,
	ctx?: PipelineContext,
): Promise<PlanResult> {
	const isReactMode = triage.action === "react";
	const systemPrompt = buildPlanningSystemPrompt(isReactMode);
	const personalityPrompt = personalityToPrompt(personality);

	// 会話コンテキスト（最新10件のみ）
	const recentHistory = perception.conversationHistory.slice(-10);
	const contextLines: string[] = [];
	for (const entry of recentHistory) {
		if (typeof entry.content === "string") {
			contextLines.push(entry.content);
		} else {
			const textPart = (entry.content as ChatCompletionContentPart[]).find(
				(p): p is Extract<ChatCompletionContentPart, { type: "text" }> =>
					p.type === "text",
			);
			if (textPart) contextLines.push(textPart.text);
		}
	}

	// チャンネルカテゴリ状態
	let channelCategoryInfo = "";
	if (ctx) {
		if (ctx.isChannelCategorized && ctx.channelCategoryId) {
			channelCategoryInfo = `\n## チャンネルカテゴリ状態\nこのチャンネルは「${ctx.channelCategoryId}」に分類されています`;
		} else {
			channelCategoryInfo =
				"\n## チャンネルカテゴリ状態\nこのチャンネルは未分類です（メンション時のみ反応）";
		}
	}

	const userContent = `
${personalityPrompt}

## トリアージ結果
- action: ${triage.action}
- intent: ${triage.intent}
- emotional_note: ${triage.emotional_note}
- confidence: ${triage.confidence}
${channelCategoryInfo}

## 直近の会話
${contextLines.join("\n") || "(なし)"}

## 判定対象メッセージ
[${perception.author}]: ${perception.content}
${perception.isMentioned ? "⚠ メンションされています" : ""}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userContent },
			],
			temperature: 0.3,
			max_tokens: 1024,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[pipeline/planning] Empty response");
			return DEFAULT_PLAN;
		}

		const parsed = parseLlmJson<Partial<PlanResult>>(raw);
		if (!parsed) {
			console.warn("[pipeline/planning] No valid JSON in response:", raw);
			return DEFAULT_PLAN;
		}

		return {
			actions: parsed.actions ?? ["do_nothing"],
			reply_approach: parsed.reply_approach ?? null,
			reply_as_normal: parsed.reply_as_normal ?? true,
			react_emoji: parsed.react_emoji ?? null,
			should_memorize: parsed.should_memorize ?? false,
			memo: parsed.memo ?? null,
			memo_impact: parsed.memo_impact ?? 2,
			should_search: parsed.should_search ?? false,
			search_query: parsed.search_query ?? null,
			categorize_channel_id: parsed.categorize_channel_id ?? null,
			categorize_category: parsed.categorize_category ?? null,
		};
	} catch (error) {
		console.error("[pipeline/planning] Error:", error);
		return DEFAULT_PLAN;
	}
}
