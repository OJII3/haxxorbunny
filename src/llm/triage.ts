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
与えられたメッセージと会話コンテキストから、bot が取るべきアクションを高速に判定してください。

## 判定基準
- ignore: 完全に bot に無関係で、他人が割り込んでも不自然な場合のみ
- reaction: 面白い・共感できる内容だがわざわざ返信するほどでもない場合（絵文字で反応）
- reply: bot に話しかけている、質問されている、話題に関連して返信すべき場合
- message: 会話の流れに自然に参加したい場合（返信ではなく独立発言）

## 基本方針
- 積極的に参加する。他人が反応しても良さそうな会話であれば reply や message を選ぶ
- 時間帯は考慮しない（深夜でも関係なく参加する）
- 迷ったら ignore より reply/message を選ぶ

## コンテキスト考慮
- 直近の会話の流れ
- bot の最後のアクションからの経過時間（同じ話題に連投しすぎない程度に）
- メッセージの内容と盛り上がり

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

	return `
## 直近の会話 (最新10件)
${conversationLog || "(なし)"}

## bot の最後のアクション
${lastAction ? `${timeSinceLastAction} — action: ${lastAction.action}, content: ${lastAction.content ?? "(なし)"}` : "まだアクションなし"}

## 判定対象メッセージ
[${authorName}]: ${messageContent}
`.trim();
}

export async function triage(
	channelId: string,
	messageContent: string,
	authorName: string,
): Promise<TriageResult> {
	const context = buildTriageContext(channelId, messageContent, authorName);

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: TRIAGE_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.3,
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
