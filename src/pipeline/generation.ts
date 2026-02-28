import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { stripMarkdown } from "../agent/tools/discord.ts";
import { client } from "../client.ts";
import { config } from "../config.ts";
import { llm } from "../llm/client.ts";
import { memoryToPrompt } from "../llm/memory.ts";
import { personalityToPrompt } from "../llm/prompts/personality.ts";
import { type BotIdentity, buildSoul } from "../llm/prompts/system.ts";
import { formatJSTFull, formatJSTShort } from "../utils/time.ts";
import { buildGenerationSystemPrompt } from "./prompts/generation.ts";
import type {
	GenerationResult,
	PerceptionResult,
	PipelineContext,
	PlanResult,
} from "./types.ts";

/** depth injection 用のアイデンティティリマインダー */
const IDENTITY_DEPTH_REMINDER = {
	role: "system" as const,
	content:
		"[リマインド] あなたは「世界の泡の住人」というキャラ。短く雑に。1〜2文。プレーンテキストのみ。頭を使わない。丁寧にならない。三人称で自分を呼ばない。",
};

/**
 * Phase 3: 生成
 * テキスト生成に集中。ツール定義なし
 */
export async function generate(
	planResult: PlanResult,
	perception: PerceptionResult,
	ctx: PipelineContext,
	searchResults?: string,
): Promise<GenerationResult> {
	const botUser = client.user;
	const me = ctx.guild.members.me;
	const identity: BotIdentity = {
		botUserId: botUser?.id ?? config.discord.appId,
		botUsername: botUser?.username ?? "haxxorbunny",
		displayName: me?.displayName ?? botUser?.displayName ?? "世界の泡の住人",
	};

	const soulText = buildSoul(identity);
	const personalityPrompt = personalityToPrompt(ctx.personality);
	const memoryPrompt = memoryToPrompt(ctx.memory, ctx.globalMemory);

	const systemPrompt = buildGenerationSystemPrompt(
		soulText,
		personalityPrompt,
		memoryPrompt,
		planResult.reply_approach,
	);

	// 会話メッセージを構築
	const messages: Array<{
		role: "system" | "user" | "assistant";
		content: string | ChatCompletionContentPart[];
	}> = [{ role: "system", content: systemPrompt }];

	// チャンネル情報
	messages.push({
		role: "system",
		content: `現在のチャンネル: #${perception.channel.name}${perception.channel.topic ? `\nチャンネルトピック: ${perception.channel.topic}` : ""}
現在時刻: ${formatJSTFull(new Date())}`,
	});

	// 検索結果がある場合
	if (searchResults) {
		messages.push({
			role: "system",
			content: `## Web検索結果\n${searchResults}`,
		});
	}

	// 会話履歴（最新10件）
	const recentHistory = perception.conversationHistory.slice(-10);
	for (const entry of recentHistory) {
		messages.push(entry);
	}

	// トリガーメッセージ
	if (perception.triggerMessage) {
		const triggerTime = formatJSTShort(
			new Date(perception.triggerMessage.createdTimestamp),
		);
		const triggerText = `[${triggerTime} ${perception.author}]: ${perception.content}`;
		messages.push({ role: "user", content: triggerText });
	}

	if (perception.isMentioned) {
		messages.push({
			role: "system",
			content:
				"名前を呼ばれた。いつも通り、短く雑に返す。丁寧に答えたり長文で説明する必要はない。",
		});
	}

	// depth injection
	injectIdentityReminder(messages);

	try {
		const response = await llm.chat.completions.create({
			model: config.llm.model,
			messages: messages as Parameters<
				typeof llm.chat.completions.create
			>[0]["messages"],
			temperature: 0.8,
			max_tokens: 512,
		});

		const rawText = response.choices[0]?.message?.content?.trim();
		if (!rawText) {
			console.warn("[pipeline/generation] Empty response");
			return { text: "うーん" };
		}

		const text = stripConversationPrefix(stripMarkdown(rawText));
		return { text };
	} catch (error) {
		console.error("[pipeline/generation] Error:", error);
		return { text: "むむ" };
	}
}

/** LLM 出力から会話履歴プレフィックス「[MM/DD HH:MM 名前]:」を除去する */
function stripConversationPrefix(text: string): string {
	return text.replace(/^\[[\d/]+ [\d:]+ [^\]]*\]:?\s*/g, "");
}

/** depth injection: 会話メッセージが6件以上ある場合、最新4メッセージ手前にリマインダーを挿入 */
function injectIdentityReminder(
	messages: Array<{
		role: "system" | "user" | "assistant";
		content: unknown;
	}>,
): void {
	const conversationIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		const role = messages[i]?.role;
		if (role === "user" || role === "assistant") {
			conversationIndices.push(i);
		}
	}
	if (conversationIndices.length < 6) return;
	const targetConvIdx = conversationIndices[conversationIndices.length - 4];
	if (targetConvIdx === undefined) return;
	messages.splice(targetConvIdx, 0, IDENTITY_DEPTH_REMINDER);
}
