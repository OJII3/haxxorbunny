import { config } from "../config.ts";
import { getLastBotAction, getRecentMessages } from "../db/queries.ts";
import { formatJSTFull, formatJSTShort } from "../utils/time.ts";
import {
	type ChannelPolicy,
	DEFAULT_NON_HOME_POLICY,
	getChannelPolicy,
} from "./channel-policy.ts";
import { isHomeChannel } from "./home-channels.ts";
import type { MoodState } from "./prompts/personality.ts";
import { triageLlm } from "./triage-client.ts";

export interface TriageResult {
	action: "ignore" | "react" | "engage";
	reasoning: string;
	confidence: number;
	emoji?: string;
}

/**
 * mood の sociability + curiosity の平均で3段階の方針を切り替える。
 * channelPolicy がある場合はそのオフセットを適用。
 * 非ホーム + ポリシー未設定の場合は DEFAULT_NON_HOME_POLICY のオフセットを適用。
 */
function buildTriageSystemPrompt(
	mood?: MoodState,
	options?: { isHome: boolean; channelPolicy?: ChannelPolicy | null },
): string {
	let avg = mood ? (mood.sociability + mood.curiosity) / 2 : 0.5;

	if (options?.channelPolicy) {
		// カスタムポリシーがある場合はそのオフセットを適用
		avg = Math.max(0, Math.min(1, avg + options.channelPolicy.avg_offset));
	} else if (options && !options.isHome) {
		// 非ホーム + ポリシー未設定 → デフォルトの保守的オフセット
		avg = Math.max(0, Math.min(1, avg + DEFAULT_NON_HOME_POLICY.avg_offset));
	}
	// ホーム + ポリシー未設定 → avg そのまま

	let policySection: string;

	if (avg > 0.7) {
		// 積極的: 迷ったら engage
		policySection = `## 判定基準 — 積極的に参加する
- engage: 基本はこちら。会話に参加できそうなら積極的に加わる
- react: 発言するほどではないが、面白い・共感・応援などを感じたら絵文字リアクションを付ける。積極的に使ってOK
- ignore: 以下の条件に該当する場合のみ

## ignore すべき場面
1. **完全に無関係**: 自分に全く関係ない事務連絡
2. **邪魔になる**: 真剣な議論に茶々を入れることになる場合
3. **直前に発言済み**: ごく最近発言したばかりで連投になる場合

## react すべき場面
1. **面白い・共感する**: 会話に参加するほどではないが、何か感じた時
2. **応援したい**: 誰かが頑張っている、成果を出した時
3. **acknowledge したい**: 読んだよ、という気持ちを伝えたい時

## engage すべき場面
1. **メンションされている**: ほぼ確実に engage
2. **面白そうな話題**: 自分が興味を持てる、コメントできそうな話題
3. **会話が途切れそう**: 話題を広げたり盛り上げたりできそうなとき
4. **質問や疑問がある**: 誰かの発言に反応したくなったとき
5. **雑談の輪に入りたい**: 気軽な会話にも参加してOK

## 基本方針
- **積極的**であること。迷ったら engage を選ぶ
- 話しかけられていなくても、面白そうなら参加する
- react は engage するほどでもない時の軽い反応手段`;
	} else if (avg > 0.4) {
		// 普通: 既存と同等
		policySection = `## 判定基準 — 必要なときに参加する
- ignore: 基本はこちら。普通の会話には割り込まない
- react: 発言するほどではないが何か感じた時に、絵文字リアクションを付ける
- engage: 以下の条件に該当する場合のみ

## react すべき場面
1. **共感・面白い**: 発言に対して何か感じたが、わざわざ返信するほどではない時
2. **応援・お祝い**: 成果報告や頑張りに対してリアクションしたい時
3. **acknowledge**: 話題を見た、読んだことを伝えたい時

## engage すべき場面
1. **メンションされている**: bot に直接話しかけられている場合（ほぼ確実に engage）
2. **会話の混乱を整理できる**: 同じチャンネルで複数の話題が同時進行して混乱している場合に、整理や補足ができるとき
3. **誤解を防げる**: 他のメンバーに誤解を与えそうな発言があり、補足や訂正で誤解を回避できるとき
4. **直接質問されている**: メンションなしでも bot の名前を呼んで質問・依頼しているとき

## 基本方針
- **控えめ**であること。迷ったら ignore を選ぶ
- 普通の雑談、盛り上がっている会話、独り言には割り込まない
- 自分が参加しなくても会話が成立する場合は ignore
- react は engage するほどでもないが完全に無視もしたくない時に使う`;
	} else {
		// 控えめ: メンションのみ
		policySection = `## 判定基準 — メンションのみに反応する
- ignore: 基本はこちら。メンション以外には反応しない
- react: 非常に印象的なメッセージにだけ、まれに絵文字リアクションを付ける
- engage: メンション時のみ

## react すべき場面
1. **非常に印象的**: 強い感情が動いた時だけ。頻度は低くてよい

## engage すべき場面
1. **メンションされている**: bot に直接話しかけられている場合のみ engage

## 基本方針
- **非常に控えめ**であること。メンション以外は基本的に ignore
- 今は一人でいたい気分なので、積極的に会話に参加しない
- react もめったに使わない。本当に印象的な時だけ`;
	}

	// カスタム指示の注入
	let customSection = "";
	if (options?.channelPolicy?.custom_instructions) {
		customSection = `\n\n## このチャンネル固有のルール\n${options.channelPolicy.custom_instructions}`;
	}

	return `
あなたは "世界の泡の住人" のトリアージ判定エンジンです。
与えられたメッセージと会話コンテキストから、bot がこの会話に参加すべきかどうかを判定してください。

${policySection}

## コンテキスト考慮
- 直近の会話の流れ（複数の話題が混在していないか）
- メッセージの内容が誤解を招きそうかどうか
- bot にメンションされているかどうか（コンテキストに記載あり）
${customSection}

## 応答フォーマット
JSON のみを返すこと。それ以外のテキストは一切不要。reasoning は10字以内。
- ignore/engage の場合: {"action":"ignore","reasoning":"理由","confidence":0.8}
- react の場合: {"action":"react","reasoning":"理由","confidence":0.7,"emoji":"👍"}
  - emoji は Unicode 絵文字1つを指定すること（カスタム絵文字は使えない）
`.trim();
}

function buildTriageContext(
	channelId: string,
	channelName: string,
	messageContent: string,
	authorName: string,
	isMentioned: boolean,
): string {
	const recentMessages = getRecentMessages(channelId, 20);
	const lastAction = getLastBotAction(channelId);

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

	return `
## チャンネル: #${channelName}
## 現在時刻: ${formatJSTFull(now)}

## 直近の会話 (最新20件)
${conversationLog || "(なし)"}

## bot の最後のアクション
${lastAction ? `${timeSinceLastAction} — action: ${lastAction.action}, content: ${lastAction.content ?? "(なし)"}` : "まだアクションなし"}

## 判定対象メッセージ
[${authorName}]: ${messageContent}${mentionNote}
`.trim();
}

export async function triage(
	channelId: string,
	channelName: string,
	messageContent: string,
	authorName: string,
	isMentioned: boolean,
	mood?: MoodState,
	options?: { guildId?: string },
): Promise<TriageResult> {
	const context = buildTriageContext(
		channelId,
		channelName,
		messageContent,
		authorName,
		isMentioned,
	);

	// ホームチャンネル判定（メンション時はペナルティなし）
	let isHome = true;
	if (options?.guildId) {
		isHome = isMentioned ? true : isHomeChannel(options.guildId, channelId);
	}

	// チャンネルポリシーの読み込み（メンション時はバイパス）
	let channelPolicy: ChannelPolicy | null = null;
	if (options?.guildId && !isMentioned) {
		channelPolicy = getChannelPolicy(options.guildId, channelId);
	}

	const systemPrompt = buildTriageSystemPrompt(mood, {
		isHome,
		channelPolicy,
	});

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

		// ポリシーベースの react ブロック判定
		const allowReact = channelPolicy
			? channelPolicy.allow_react
			: isHome
				? true
				: DEFAULT_NON_HOME_POLICY.allow_react;

		if (parsed.action === "react" && !allowReact) {
			console.log("[triage] react blocked by policy, downgrading to ignore");
			return {
				action: "ignore",
				reasoning: `react blocked by policy: ${parsed.reasoning}`,
				confidence: parsed.confidence,
			};
		}

		// react で emoji がない場合は ignore にフォールバック
		if (parsed.action === "react" && !parsed.emoji) {
			console.warn(
				"[triage] react action without emoji, falling back to ignore",
			);
			return {
				action: "ignore",
				reasoning: parsed.reasoning,
				confidence: parsed.confidence,
			};
		}

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
