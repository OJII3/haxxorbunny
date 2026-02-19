import { config } from "../config.ts";
import { getLastBotAction, getRecentMessages } from "../db/queries.ts";
import type { MoodState } from "./prompts/personality.ts";
import { triageLlm } from "./triage-client.ts";

export interface TriageResult {
	action: "ignore" | "engage";
	reasoning: string;
	confidence: number;
}

/**
 * mood の sociability + curiosity の平均で3段階の方針を切り替える
 */
function buildTriageSystemPrompt(mood?: MoodState): string {
	const avg = mood ? (mood.sociability + mood.curiosity) / 2 : 0.5;

	let policySection: string;

	if (avg > 0.7) {
		// 積極的: 迷ったら engage
		policySection = `## 判定基準 — 積極的に参加する
- engage: 基本はこちら。会話に参加できそうなら積極的に加わる
- ignore: 以下の条件に該当する場合のみ

## ignore すべき場面
1. **完全に無関係**: 自分に全く関係ない事務連絡
2. **邪魔になる**: 真剣な議論に茶々を入れることになる場合
3. **直前に発言済み**: ごく最近発言したばかりで連投になる場合

## engage すべき場面
1. **メンションされている**: ほぼ確実に engage
2. **面白そうな話題**: 自分が興味を持てる、コメントできそうな話題
3. **会話が途切れそう**: 話題を広げたり盛り上げたりできそうなとき
4. **質問や疑問がある**: 誰かの発言に反応したくなったとき
5. **雑談の輪に入りたい**: 気軽な会話にも参加してOK

## 基本方針
- **積極的**であること。迷ったら engage を選ぶ
- 話しかけられていなくても、面白そうなら参加する`;
	} else if (avg > 0.4) {
		// 普通: 既存と同等
		policySection = `## 判定基準 — 必要なときに参加する
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
- 自分が参加しなくても会話が成立する場合は ignore`;
	} else {
		// 控えめ: メンションのみ
		policySection = `## 判定基準 — メンションのみに反応する
- ignore: 基本はこちら。メンション以外には反応しない
- engage: メンション時のみ

## engage すべき場面
1. **メンションされている**: bot に直接話しかけられている場合のみ engage

## 基本方針
- **非常に控えめ**であること。メンション以外は基本的に ignore
- 今は一人でいたい気分なので、積極的に会話に参加しない`;
	}

	return `
あなたは Discord bot "haxxorbunny" のトリアージ判定エンジンです。
与えられたメッセージと会話コンテキストから、bot がこの会話に参加すべきかどうかを判定してください。

${policySection}

## コンテキスト考慮
- 直近の会話の流れ（複数の話題が混在していないか）
- メッセージの内容が誤解を招きそうかどうか
- bot にメンションされているかどうか（コンテキストに記載あり）

## 応答フォーマット
JSON のみを返すこと。それ以外のテキストは一切不要。reasoning は10字以内。
{"action":"ignore","reasoning":"理由","confidence":0.8}
`.trim();
}

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
	mood?: MoodState,
): Promise<TriageResult> {
	const context = buildTriageContext(
		channelId,
		messageContent,
		authorName,
		isMentioned,
	);

	const systemPrompt = buildTriageSystemPrompt(mood);

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
