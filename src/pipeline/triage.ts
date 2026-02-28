import { config } from "../config.ts";
import { getLastBotAction, getRecentMessages } from "../db/queries.ts";
import { getChannelBehavior } from "../llm/channel-category.ts";
import type { MoodState } from "../llm/prompts/personality.ts";
import { triageLlm } from "../llm/triage-client.ts";
import { formatJSTFull, formatJSTShort } from "../utils/time.ts";
import { buildExtendedTriageSystemPrompt } from "./prompts/triage.ts";
import type { ExtendedTriageResult, PerceptionResult } from "./types.ts";

/**
 * Phase 1: 判断（拡張トリアージ）
 * action + intent + emotional_note を出力する
 */
export async function extendedTriage(
	perception: PerceptionResult,
	mood: MoodState,
): Promise<ExtendedTriageResult> {
	const { channel, content, author, isMentioned, guildId } = perception;

	// カテゴリの振る舞い取得（メンション時はバイパス）
	const behavior =
		guildId && !isMentioned
			? getChannelBehavior(guildId, channel.id)
			: undefined;

	const systemPrompt = buildExtendedTriageSystemPrompt(mood, behavior);

	// コンテキスト構築
	const recentMessages = getRecentMessages(channel.id, 20);
	const lastAction = getLastBotAction(channel.id);
	const now = new Date();

	const conversationLog = recentMessages
		.map((m) => {
			const time = m.createdAt ? formatJSTShort(new Date(m.createdAt)) : "?";
			return `[${time} ${m.username}]: ${m.content}`;
		})
		.join("\n");

	const timeSinceLastAction = lastAction?.createdAt
		? `${Math.floor((now.getTime() - new Date(lastAction.createdAt).getTime()) / 1000 / 60)}分前`
		: "なし";

	const mentionNote = isMentioned
		? "\n⚠ このメッセージは bot にメンションしています（名前呼びまたは @メンション）"
		: "";

	const context = `
## チャンネル: #${channel.name}
## 現在時刻: ${formatJSTFull(now)}

## 直近の会話 (最新20件)
${conversationLog || "(なし)"}

## bot の最後のアクション
${lastAction ? `${timeSinceLastAction} — action: ${lastAction.action}, content: ${lastAction.content ?? "(なし)"}` : "まだアクションなし"}

## 判定対象メッセージ
[${author}]: ${content}${mentionNote}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: context },
			],
			temperature: 0.3,
			max_tokens: 1024,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[pipeline/triage] Empty response");
			return defaultIgnore("Empty triage response");
		}

		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("[pipeline/triage] No valid JSON in response:", raw);
			return defaultIgnore("No valid JSON in triage response");
		}

		const parsed = JSON.parse(jsonMatch[0]) as Partial<ExtendedTriageResult>;

		// カテゴリベースの react ブロック判定
		const allowReact = behavior ? behavior.allow_react : true;
		if (parsed.action === "react" && !allowReact) {
			console.log(
				"[pipeline/triage] react blocked by policy, downgrading to ignore",
			);
			return {
				action: "ignore",
				intent: parsed.intent ?? "特になし",
				emotional_note: parsed.emotional_note ?? "特に何も",
				reasoning: `react blocked by policy: ${parsed.reasoning ?? ""}`,
				confidence: parsed.confidence ?? 0,
			};
		}

		return {
			action: parsed.action ?? "ignore",
			intent: parsed.intent ?? "特になし",
			emotional_note: parsed.emotional_note ?? "特に何も",
			reasoning: parsed.reasoning ?? "",
			confidence: parsed.confidence ?? 0,
		};
	} catch (error) {
		console.error("[pipeline/triage] Error:", error);
		return defaultIgnore("Triage error");
	}
}

function defaultIgnore(reasoning: string): ExtendedTriageResult {
	return {
		action: "ignore",
		intent: "特になし",
		emotional_note: "特に何も",
		reasoning,
		confidence: 0,
	};
}
