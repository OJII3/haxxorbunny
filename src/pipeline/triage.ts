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

	const messages = [
		{ role: "system" as const, content: systemPrompt },
		{ role: "user" as const, content: context },
	];

	try {
		const parsed = await callTriageWithRetry(messages);

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

/**
 * LLM レスポンスから JSON をパースする。不完全な JSON は末尾に } を補完して再試行する。
 */
function parseTriageJson(raw: string): Partial<ExtendedTriageResult> | null {
	const cleaned = raw
		.replace(/^```(?:json)?\s*\n?/i, "")
		.replace(/\n?```\s*$/i, "");
	const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]) as Partial<ExtendedTriageResult>;
		} catch {
			// パース失敗 — 下で補完を試みる
		}
	}

	// 不完全な JSON を補完して再試行（末尾の } が欠けているケース）
	const braceMatch = cleaned.match(/\{[\s\S]*/);
	if (braceMatch) {
		const partial = braceMatch[0];
		// 文字列が閉じていない場合は閉じてから } を追加
		const openQuotes = (partial.match(/(?<!\\)"/g) || []).length;
		let repaired = partial;
		if (openQuotes % 2 !== 0) {
			repaired += '"';
		}
		repaired += "}";
		try {
			return JSON.parse(repaired) as Partial<ExtendedTriageResult>;
		} catch {
			// 補完でも失敗
		}
	}

	return null;
}

/**
 * Triage LLM を呼び出し、JSON パース失敗時は1回リトライする。
 */
async function callTriageWithRetry(
	messages: { role: "system" | "user"; content: string }[],
): Promise<Partial<ExtendedTriageResult>> {
	const maxAttempts = 2;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages,
			temperature: 0.3,
			max_tokens: 1024,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn(
				`[pipeline/triage] Empty response (attempt ${attempt}/${maxAttempts})`,
			);
			continue;
		}

		const parsed = parseTriageJson(raw);
		if (parsed) {
			return parsed;
		}

		console.warn(
			`[pipeline/triage] No valid JSON (attempt ${attempt}/${maxAttempts}):`,
			raw,
		);
	}

	throw new Error("Triage JSON parse failed after retries");
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
