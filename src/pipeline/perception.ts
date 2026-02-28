import type { Message } from "discord.js";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { client } from "../client.ts";
import { formatJSTShort } from "../utils/time.ts";
import type { ConversationEntry, PerceptionResult } from "./types.ts";

export const IMAGE_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);
const MAX_IMAGES_PER_MESSAGE = 4;

/** Discord Message から画像 attachment を抽出し、OpenAI の image_url パーツ配列を返す */
function extractImageParts(msg: Message): ChatCompletionContentPart[] {
	const parts: ChatCompletionContentPart[] = [];
	for (const attachment of msg.attachments.values()) {
		if (parts.length >= MAX_IMAGES_PER_MESSAGE) break;
		if (
			attachment.contentType &&
			IMAGE_CONTENT_TYPES.has(attachment.contentType)
		) {
			parts.push({
				type: "image_url",
				image_url: { url: attachment.url, detail: "low" },
			});
		}
	}
	return parts;
}

/** メッセージ配列から会話履歴を構築する */
export function buildConversationHistory(
	messages: Message[],
): ConversationEntry[] {
	const botUserId = client.user?.id;
	return messages.map((msg) => {
		const time = formatJSTShort(new Date(msg.createdTimestamp));
		const text = `[${time} ${msg.author.displayName}]: ${msg.content}`;
		const isSelf = botUserId !== undefined && msg.author.id === botUserId;
		const imageParts = isSelf ? [] : extractImageParts(msg);
		return {
			role: (isSelf ? "assistant" : "user") as "user" | "assistant",
			content:
				imageParts.length > 0
					? [{ type: "text" as const, text }, ...imageParts]
					: text,
		};
	});
}

/** 画像 attachment の情報をテキストとして追記する */
export function appendImageInfo(content: string, message: Message): string {
	const imageAttachments = [...message.attachments.values()]
		.filter((a) => a.contentType && IMAGE_CONTENT_TYPES.has(a.contentType))
		.slice(0, MAX_IMAGES_PER_MESSAGE);
	if (imageAttachments.length === 0) return content;
	const tags = imageAttachments.map((a) => `[画像: ${a.name}]`).join(" ");
	return content ? `${content} ${tags}` : tags;
}

/**
 * Phase 0: 知覚
 * メッセージから構造化データを生成する
 */
export async function perceive(
	messages: Message[],
	hasMention: boolean,
): Promise<PerceptionResult | null> {
	if (messages.length === 0) return null;
	const lastMessage = messages.at(-1);
	if (!lastMessage?.guild) return null;

	const guild = lastMessage.guild;
	const guildId = guild.id;
	const channelId = lastMessage.channelId;
	const authorName = lastMessage.author.displayName;

	// 結合コンテンツ
	const combinedContent = messages
		.map((m) => appendImageInfo(m.content, m))
		.join("\n");

	// 画像の有無
	const hasImages = messages.some((m) =>
		[...m.attachments.values()].some(
			(a) => a.contentType && IMAGE_CONTENT_TYPES.has(a.contentType),
		),
	);

	// 会話履歴を構築（トリガーメッセージを除外して重複防止）
	const triggerId = lastMessage.id;
	const recentMessages = await lastMessage.channel.messages.fetch({
		limit: 30,
	});
	const conversationHistory = buildConversationHistory(
		[...recentMessages.values()].filter((m) => m.id !== triggerId).reverse(),
	);

	const channelName =
		"name" in lastMessage.channel
			? (lastMessage.channel.name as string)
			: channelId;
	const channelTopic =
		"topic" in lastMessage.channel
			? (lastMessage.channel.topic as string | null)
			: null;

	return {
		author: authorName,
		channel: {
			id: channelId,
			name: channelName,
			topic: channelTopic,
		},
		content: combinedContent,
		hasImages,
		isMentioned: hasMention,
		isBotMessage: lastMessage.author.bot,
		conversationHistory,
		triggerMessage: lastMessage,
		guild,
		guildId,
	};
}
