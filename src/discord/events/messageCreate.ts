import { ChannelType, type GuildMember, type Message } from "discord.js";
import {
	IMAGE_CONTENT_TYPES,
	MAX_IMAGES_PER_MESSAGE,
	markActivity,
	runAgentLoop,
} from "../../agent/loop.ts";
import type { AgentContext } from "../../agent/types.ts";
import { client } from "../../client.ts";
import {
	getRecentMessages,
	saveBotAction,
	saveMessage,
} from "../../db/queries.ts";
import { bufferMessage, setFlushHandler } from "../../llm/message-buffer.ts";
import { loadPersonality } from "../../llm/prompts/personality.ts";
import { reflect } from "../../llm/reflection.ts";
import { triage } from "../../llm/triage.ts";
import { shouldSkipTriage } from "../../llm/triage-throttle.ts";
import { voiceManager } from "../../voice/manager.ts";

function isMentioned(message: Message): boolean {
	const botUser = client.user;
	if (!botUser) return false;

	if (message.mentions.has(botUser)) return true;

	const lowerContent = message.content.toLowerCase();
	if (lowerContent.includes("aiおかず")) return true;
	if (message.content.includes("世界の泡の住人")) return true;

	return false;
}

/** VC 参加リクエストのキーワード */
const VOICE_JOIN_KEYWORDS = [
	"通話して",
	"通話しよ",
	"通話来て",
	"通話きて",
	"通話入って",
	"通話はいって",
	"通話しない",
	"vc来て",
	"vcきて",
	"vcに来て",
	"vcにきて",
	"vc入って",
	"vcはいって",
	"vc参加",
	"ボイチャ",
	"ボイスチャット",
	"voice",
	"おいで",
	"話そう",
	"話しよ",
	"喋ろう",
	"しゃべろう",
];

function isVoiceJoinRequest(content: string): boolean {
	const lower = content.toLowerCase();
	return VOICE_JOIN_KEYWORDS.some((kw) => lower.includes(kw));
}

async function handleVoiceJoinRequest(message: Message): Promise<boolean> {
	const guild = message.guild;
	if (!guild) return false;

	const member = message.member as GuildMember | null;
	if (!member) return false;

	// メンバーが VC にいるか確認
	const voiceChannel = member.voice.channel;
	if (!voiceChannel) {
		if (message.channel.isSendable()) {
			await message.reply("先にVCに入ってから呼んでね！");
		}
		return true;
	}

	// 既にセッションがある場合
	if (voiceManager.hasActiveSession(guild.id)) {
		if (message.channel.isSendable()) {
			await message.reply("もう通話中だよ！");
		}
		return true;
	}

	// テキストチャンネルを取得
	const textChannel =
		message.channel.type === ChannelType.GuildText ||
		message.channel.type === ChannelType.GuildVoice
			? message.channel
			: null;
	if (!textChannel) return true;

	try {
		await voiceManager.startSession(guild, voiceChannel, textChannel);
		if (message.channel.isSendable()) {
			await message.reply(`${voiceChannel.name} に参加したよ！`);
		}
	} catch (error) {
		console.error("[voice] Failed to start voice session:", error);
		if (message.channel.isSendable()) {
			await message.reply("VCへの参加に失敗しちゃった…");
		}
	}

	return true;
}

function buildConversationContext(channelId: string): string {
	const messages = getRecentMessages(channelId, 10);
	return messages.map((m) => `[${m.username}]: ${m.content}`).join("\n");
}

async function processBufferedMessages(
	messages: Message[],
	hasMention: boolean,
): Promise<void> {
	if (messages.length === 0) return;

	const lastMessage = messages.at(-1);
	if (!lastMessage) return;

	const guildId = lastMessage.guild?.id;
	if (!guildId) return;

	const channelId = lastMessage.channelId;
	const authorName = lastMessage.author.displayName;

	// 結合コンテンツ（複数メッセージを改行で結合、画像情報をテキスト追記）
	const combinedContent = messages
		.map((m) => appendImageInfo(m.content, m))
		.join("\n");

	console.log(
		`[buffer] flushing ${messages.length} message(s) from ${authorName} in ${channelId}`,
	);

	// 統合ガード: チャンネルロック / 応答後クールダウン / スロットル
	if (shouldSkipTriage(channelId, hasMention)) {
		return;
	}

	try {
		const personality = loadPersonality();
		const triageResult = await triage(
			channelId,
			combinedContent,
			authorName,
			hasMention,
			personality.mood,
		);

		console.log(
			`[triage] ${triageResult.action} (${triageResult.confidence}) | reason: ${triageResult.reasoning}`,
		);

		switch (triageResult.action) {
			case "ignore": {
				const ctx = buildConversationContext(channelId);
				reflect(
					guildId,
					channelId,
					combinedContent,
					authorName,
					"ignore",
					ctx,
				).catch((e) => console.error("[reflection] fire-and-forget error:", e));
				break;
			}

			case "react": {
				if (triageResult.emoji) {
					try {
						await lastMessage.react(triageResult.emoji);
						saveBotAction({
							guildId,
							channelId,
							action: "add_reaction",
							content: triageResult.emoji,
							reasoning: triageResult.reasoning,
							triggeredBy: "triage",
						});
						console.log(
							`[triage] reacted with ${triageResult.emoji} to message in ${channelId}`,
						);
					} catch (e) {
						console.error("[triage] Failed to react:", e);
					}
				}
				// reflection で personality/memory 更新（fire-and-forget）
				const ctx = buildConversationContext(channelId);
				reflect(
					guildId,
					channelId,
					combinedContent,
					authorName,
					"react",
					ctx,
				).catch((e) => console.error("[reflection] fire-and-forget error:", e));
				break;
			}

			case "engage": {
				const guild = lastMessage.guild;
				if (!guild) break;

				const agentCtx: AgentContext = {
					triggerMessage: lastMessage,
					channel: lastMessage.channel,
					guild,
					triggeredBy: "triage",
					isMentioned: hasMention,
				};
				await runAgentLoop(agentCtx);
				break;
			}
		}
	} catch (error) {
		console.error("[messageCreate] Triage handler error:", error);
	}
}

// フラッシュハンドラを登録
setFlushHandler((messages, hasMention) => {
	processBufferedMessages(messages, hasMention).catch((e) =>
		console.error("[messageCreate] processBufferedMessages error:", e),
	);
});

/** 画像 attachment の情報をテキストとして追記する（LLM に渡す画像と同じフィルタ・上限を使用） */
function appendImageInfo(content: string, message: Message): string {
	const imageAttachments = [...message.attachments.values()]
		.filter((a) => a.contentType && IMAGE_CONTENT_TYPES.has(a.contentType))
		.slice(0, MAX_IMAGES_PER_MESSAGE);
	if (imageAttachments.length === 0) return content;
	const tags = imageAttachments.map((a) => `[画像: ${a.name}]`).join(" ");
	return content ? `${content} ${tags}` : tags;
}

export async function handleMessageCreate(message: Message): Promise<void> {
	// すべてのメッセージを DB に保存（画像情報をテキスト追記）
	saveMessage({
		guildId: message.guildId ?? "",
		channelId: message.channelId,
		userId: message.author.id,
		username: message.author.displayName,
		content: appendImageInfo(message.content, message),
		isBot: message.author.bot,
	});

	// Bot のメッセージは無視
	if (message.author.bot) return;

	// アクティビティ記録（人間のメッセージのみ）
	markActivity();

	// メンション判定
	const mentioned = isMentioned(message);

	// VC 参加リクエストの検出（メンション + VCキーワード）
	if (mentioned && isVoiceJoinRequest(message.content)) {
		const handled = await handleVoiceJoinRequest(message);
		if (handled) return;
	}

	// デバウンスバッファにメッセージを追加
	bufferMessage(message, mentioned);
}
