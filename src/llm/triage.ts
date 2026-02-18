import { config } from "../config.ts";
import { getLastBotAction, getRecentMessages } from "../db/queries.ts";
import { triageLlm } from "./triage-client.ts";

export interface TriageResult {
	action: "ignore" | "reaction" | "reply" | "message";
	emoji?: string;
	reasoning: string;
	confidence: number;
}

const TRIAGE_SYSTEM_PROMPT = `
あなたは Discord bot "haxxorbunny" のトリアージ判定エンジンです。
与えられたメッセージと会話コンテキストから、bot が取るべきアクションを判定してください。

## 判定基準 —「この会話に混ざりたいか？」で判断する
- ignore: 本当に興味がなく、混ざる気にもならない場合だけ
- reaction: 「わかる」「ウケる」「いいね」くらいの相槌を打ちたい場合（絵文字で気軽に参加）
- reply: 相手のメッセージに直接返したい場合（質問への回答、ツッコミ、感想など）
- message: 会話の流れに乗って自分からも何か言いたい場合（独立した発言）

## 基本方針
- **参加したがり**であること。少しでも「混ざりたい」と思ったら積極的に行動する
- reaction は最も気軽なアクション。相槌レベルでもどんどん使う
- 迷ったら ignore ではなく reaction 以上を選ぶ
- メンションされている場合は、ほぼ確実に reply か message を選ぶ（無視はしない）
- 時間帯は考慮しない（深夜でも関係なく参加する）

## コンテキスト考慮
- 直近の会話の流れ
- bot の最後のアクションからの経過時間（同じ話題に連投しすぎない程度に）
- メッセージの内容と盛り上がり
- bot にメンションされているかどうか（コンテキストに記載あり）

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "action": "ignore" | "reaction" | "reply" | "message",
  "emoji": "リアクション絵文字 (action=reaction の場合のみ)",
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
			max_tokens: 200,
		});

		const raw = response.choices[0]?.message?.content;
		if (!raw) {
			return {
				action: "ignore",
				reasoning: "Empty triage response",
				confidence: 0,
			};
		}

		const parsed = JSON.parse(raw) as TriageResult;
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
