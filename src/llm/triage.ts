import { config } from "../config.ts";
import { getLastBotAction, getRecentMessages } from "../db/queries.ts";
import { triageLlm } from "./triage-client.ts";

export interface TriageResult {
	action: "ignore" | "engage";
	reasoning: string;
	confidence: number;
}

const TRIAGE_SYSTEM_PROMPT = `
あなたは Discord bot "haxxorbunny" のトリアージ判定エンジンです。
与えられたメッセージと会話コンテキストから、bot がこの会話に参加すべきかどうかを判定してください。

## 判定基準 — 本当に必要なときだけ参加する
- ignore: 基本はこちら。普通の会話には割り込まない
- engage: 以下の条件に該当する場合のみ

## engage すべき場面
1. **メンションされている**: bot に直接話しかけられている場合（ほぼ確実に engage）
2. **会話の混乱を整理できる**: 同じチャンネルで複数の話題が同時進行して混乱している場合に、整理や補足ができるとき
3. **誤解を防げる**: 他のメンバーに誤解を与えそうな発言があり、補足や訂正で誤解を回避できるとき
4. **直接質問されている**: メンションなしでも bot の名前を呼んで質問・依頼しているとき

## 基本方針
- **控えめ**であること。迷ったら ignore を選ぶ
- 普通の雑談、盛り上がっている会話、独り言には割り込まない
- 自分が参加しなくても会話が成立する場合は ignore

## コンテキスト考慮
- 直近の会話の流れ（複数の話題が混在していないか）
- メッセージの内容が誤解を招きそうかどうか
- bot にメンションされているかどうか（コンテキストに記載あり）

## 応答フォーマット
JSON のみを返すこと。それ以外のテキストは一切不要。reasoning は10字以内。
{"action":"ignore","reasoning":"理由","confidence":0.8}
`.trim();

function buildTriageContext(
	channelId: string,
	messageContent: string,
	authorName: string,
	isMentioned: boolean,
): string {
	const recentMessages = getRecentMessages(channelId, 10);
	const lastAction = getLastBotAction(channelId);

	const now = new Date();

	const conversationLog = recentMessages
		.map((m) => `[${m.username}]: ${m.content}`)
		.join("\n");

	const timeSinceLastAction = lastAction?.createdAt
		? `${Math.floor((now.getTime() - new Date(lastAction.createdAt).getTime()) / 1000 / 60)}分前`
		: "なし";

	const mentionNote = isMentioned
		? "\n⚠ このメッセージは bot にメンションしています（名前呼びまたは @メンション）"
		: "";

	return `
## 直近の会話 (最新10件)
${conversationLog || "(なし)"}

## bot の最後のアクション
${lastAction ? `${timeSinceLastAction} — action: ${lastAction.action}, content: ${lastAction.content ?? "(なし)"}` : "まだアクションなし"}

## 判定対象メッセージ
[${authorName}]: ${messageContent}${mentionNote}
`.trim();
}

export async function triage(
	channelId: string,
	messageContent: string,
	authorName: string,
	isMentioned: boolean,
): Promise<TriageResult> {
	const context = buildTriageContext(
		channelId,
		messageContent,
		authorName,
		isMentioned,
	);

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: TRIAGE_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.3,
			max_tokens: 1024,
		});

		const choice = response.choices[0];
		const raw = choice?.message?.content?.trim();
		const finishReason = choice?.finish_reason;

		if (!raw) {
			console.warn("[triage] Empty response, finish_reason:", finishReason);
			return {
				action: "ignore",
				reasoning: "Empty triage response",
				confidence: 0,
			};
		}

		// マークダウンコードブロックを除去してから JSON 部分を抽出
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			// JSON パース不能な応答は信頼できないので ignore にフォールバック
			console.warn(
				"[triage] No valid JSON in response, defaulting to ignore:",
				raw,
			);
			return {
				action: "ignore",
				reasoning: "No valid JSON in triage response, defaulting to ignore",
				confidence: 0,
			};
		}

		const parsed = JSON.parse(jsonMatch[0]) as TriageResult;
		return parsed;
	} catch (error) {
		console.error("[triage] Error:", error);
		return {
			action: "ignore",
			reasoning: "Triage error, defaulting to ignore",
			confidence: 0,
		};
	}
}
