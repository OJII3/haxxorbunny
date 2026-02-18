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

## 判定基準 —「この会話に混ざりたいか？」で判断する
- ignore: 本当に興味がなく、混ざる気にもならない場合だけ
- engage: 少しでも「混ざりたい」「反応したい」と思った場合（リアクション・返信・発言すべて含む）

## 基本方針
- **参加したがり**であること。少しでも「混ざりたい」と思ったら engage
- 迷ったら ignore ではなく engage を選ぶ
- メンションされている場合は、ほぼ確実に engage を選ぶ（無視はしない）
- 時間帯は考慮しない（深夜でも関係なく参加する）

## コンテキスト考慮
- 直近の会話の流れ
- bot の最後のアクションからの経過時間（同じ話題に連投しすぎない程度に）
- メッセージの内容と盛り上がり
- bot にメンションされているかどうか（コンテキストに記載あり）

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "action": "ignore" | "engage",
  "reasoning": "判定理由（短く）",
  "confidence": 0.0〜1.0
}
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
			temperature: 0.5,
			max_tokens: 512,
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
			// 切り詰められた JSON から action だけでも抽出を試みる
			const actionMatch = raw.match(/"action"\s*:\s*"(ignore|engage)/);
			if (actionMatch) {
				const action = actionMatch[1] as TriageResult["action"];
				console.warn("[triage] Truncated response, extracted action:", action);
				return {
					action,
					reasoning: "Truncated triage response",
					confidence: 0.5,
				};
			}
			console.warn("[triage] No JSON found in response:", raw);
			return {
				action: "ignore",
				reasoning: "No JSON in triage response",
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
