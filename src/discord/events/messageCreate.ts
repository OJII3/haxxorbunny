import { ChannelType, type GuildMember, type Message } from "discord.js";
import {
	IMAGE_CONTENT_TYPES,
	MAX_IMAGES_PER_MESSAGE,
	markActivity,
	runAgentLoop,
} from "../../agent/loop.ts";
import type { AgentContext } from "../../agent/types.ts";
import { client } from "../../client.ts";
import { getRecentMessages, saveMessage } from "../../db/queries.ts";
import {
	isChannelCategorized,
	shouldRespondToBots,
} from "../../llm/channel-category.ts";
import { bufferMessage, setFlushHandler } from "../../llm/message-buffer.ts";
import { loadPersonality } from "../../llm/prompts/personality.ts";
import { reflect } from "../../llm/reflection.ts";
import { triage } from "../../llm/triage.ts";
import { shouldSkipTriage } from "../../llm/triage-throttle.ts";
import { formatJSTShort } from "../../utils/time.ts";
import { voiceManager } from "../../voice/manager.ts";

async function isReplyToBotMessage(message: Message): Promise<boolean> {
	if (!message.reference?.messageId) return false;
	const botUser = client.user;
	if (!botUser) return false;

	try {
		const refMessage =
			message.channel.messages.cache.get(message.reference.messageId) ??
			(await message.channel.messages.fetch(message.reference.messageId));
		return refMessage.author.id === botUser.id;
	} catch {
		return false;
	}
}

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
	return messages
		.map((m) => {
			const time = m.createdAt ? formatJSTShort(new Date(m.createdAt)) : "?";
			return `[${time} ${m.username}]: ${m.content}`;
		})
		.join("\n");
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
		const chName =
			"name" in lastMessage.channel
				? (lastMessage.channel.name as string)
				: channelId;
		const triageResult = await triage(
			channelId,
			chName,
			combinedContent,
			authorName,
			hasMention,
			personality.mood,
			{ guildId },
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
				const guild = lastMessage.guild;
				if (!guild) break;
				const agentCtx: AgentContext = {
					triggerMessage: lastMessage,
					channel: lastMessage.channel,
					guild,
					triggeredBy: "triage-react",
					isMentioned: hasMention,
					triageReactContext: {
						reasoning: triageResult.reasoning,
						confidence: triageResult.confidence,
					},
				};
				await runAgentLoop(agentCtx);
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

/** bot 連続発言の上限（無限ループ防止） */
const BOT_CHAIN_LIMIT = 3;

function isBotLoopDetected(channelId: string): boolean {
	const recent = getRecentMessages(channelId, BOT_CHAIN_LIMIT + 1);
	// 直近の連続 bot メッセージ数をカウント（新しい方から）
	let botChain = 0;
	for (let i = recent.length - 1; i >= 0; i--) {
		if (recent[i]?.isBot) botChain++;
		else break;
	}
	return botChain >= BOT_CHAIN_LIMIT;
}

export async function handleMessageCreate(message: Message): Promise<void> {
	// Bot のメッセージ: DB 保存 + bot-chat カテゴリなら処理続行
	if (message.author.bot) {
		saveMessage({
			guildId: message.guildId ?? "",
			channelId: message.channelId,
			userId: message.author.id,
			username: message.author.displayName,
			content: appendImageInfo(message.content, message),
			isBot: message.author.bot,
		});
		// 自分自身のメッセージは常にスキップ
		if (message.author.id === client.user?.id) return;
		// bot-chat カテゴリでなければスキップ
		if (
			!message.guildId ||
			!shouldRespondToBots(message.guildId, message.channelId)
		)
			return;
		// 無限ループ防止: 直近N件がbot連鎖ならスキップ
		if (isBotLoopDetected(message.channelId)) {
			console.log(
				`[messageCreate] Bot loop detected in ${message.channelId}, skipping`,
			);
			return;
		}
		// 以降の処理に進む（バッファ→トリアージ）
	}

	// メンション判定（早期に行い、後続のフィルタとバッファの両方で使用）
	const mentioned = isMentioned(message);

	// 未分類チャンネル + メンションなし + bot へのリプライでない → 完全スキップ（DB 保存もしない）
	if (message.guildId && !mentioned) {
		const categorized = isChannelCategorized(
			message.guildId,
			message.channelId,
		);
		if (!categorized) {
			const replyToBot = await isReplyToBotMessage(message);
			if (!replyToBot) {
				return;
			}
		}
	}

	// DB 保存
	saveMessage({
		guildId: message.guildId ?? "",
		channelId: message.channelId,
		userId: message.author.id,
		username: message.author.displayName,
		content: appendImageInfo(message.content, message),
		isBot: message.author.bot,
	});

	// アクティビティ記録（人間のメッセージのみ）
	markActivity();

	// VC 参加リクエストの検出（メンション + VCキーワード）
	if (mentioned && isVoiceJoinRequest(message.content)) {
		const handled = await handleVoiceJoinRequest(message);
		if (handled) return;
	}

	// デバウンスバッファにメッセージを追加
	bufferMessage(message, mentioned);
}
