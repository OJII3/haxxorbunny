import {
	ChannelType,
	type GuildTextBasedChannel,
	type TextChannel,
} from "discord.js";
import { client } from "../../client.ts";
import { saveMessage } from "../../db/queries.ts";
import { isDuplicate, recordMessage } from "../../llm/message-dedup.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

// ── helpers ──

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

function botUserId(): string {
	return client.user?.id ?? "bot";
}

// ── handlers ──

const sendMessage: ToolHandler = async (args, ctx) => {
	const content = args.content as string;
	if (!content) return fail("content is required");

	// cron トリガー時のみ重複チェック
	if (ctx.triggeredBy === "cron" && isDuplicate(ctx.guild.id, content)) {
		console.log(
			"[dedup] Blocked duplicate cron message:",
			content.slice(0, 50),
		);
		return fail(
			"This message is too similar to a recent post. Try something different.",
		);
	}

	const channelId = args.channel_id as string | undefined;
	let targetChannel = ctx.channel;

	if (channelId && channelId !== ctx.channel.id) {
		const ch = ctx.guild.channels.cache.get(channelId);
		if (!ch || !ch.isTextBased())
			return fail("Channel not found or not text-based");
		targetChannel = ch as GuildTextBasedChannel;
	}

	if (!targetChannel.isSendable()) return fail("Channel is not sendable");
	await targetChannel.send(content);
	recordMessage(ctx.guild.id, content);
	saveMessage({
		guildId: ctx.guild.id,
		channelId: targetChannel.id,
		userId: botUserId(),
		username: client.user?.displayName ?? "bot",
		content,
		isBot: true,
	});
	const channelName = "name" in targetChannel ? targetChannel.name : "DM";
	return ok(`Message sent to #${channelName}`);
};

const replyToMessage: ToolHandler = async (args, ctx) => {
	const content = args.content as string;
	if (!content) return fail("content is required");
	if (!ctx.triggerMessage) return fail("No trigger message to reply to");
	await ctx.triggerMessage.reply(content);
	saveMessage({
		guildId: ctx.guild.id,
		channelId: ctx.channel.id,
		userId: botUserId(),
		username: client.user?.displayName ?? "bot",
		content,
		isBot: true,
	});
	return ok("Reply sent");
};

const addReaction: ToolHandler = async (args, ctx) => {
	const emoji = args.emoji as string;
	if (!emoji) return fail("emoji is required");
	if (!ctx.triggerMessage) return fail("No trigger message to react to");
	try {
		await ctx.triggerMessage.react(emoji);
		return ok(`Reacted with ${emoji}`);
	} catch {
		return fail(`Failed to react with ${emoji}`);
	}
};

const editMessage: ToolHandler = async (args, ctx) => {
	const messageId = args.message_id as string;
	const content = args.content as string;
	if (!messageId || !content)
		return fail("message_id and content are required");
	try {
		const msg = await ctx.channel.messages.fetch(messageId);
		if (msg.author.id !== botUserId())
			return fail("Can only edit own messages");
		await msg.edit(content);
		return ok("Message edited");
	} catch {
		return fail("Failed to edit message");
	}
};

const deleteMessage: ToolHandler = async (args, ctx) => {
	const messageId = args.message_id as string;
	if (!messageId) return fail("message_id is required");
	try {
		const msg = await ctx.channel.messages.fetch(messageId);
		if (msg.author.id !== botUserId())
			return fail("Can only delete own messages");
		await msg.delete();
		return ok("Message deleted");
	} catch {
		return fail("Failed to delete message");
	}
};

const createThread: ToolHandler = async (args, ctx) => {
	const name = args.name as string;
	const messageId = args.message_id as string | undefined;
	if (!name) return fail("name is required");
	if (ctx.channel.type !== ChannelType.GuildText)
		return fail("Threads can only be created in text channels");
	const textChannel = ctx.channel as TextChannel;
	try {
		if (messageId) {
			const msg = await textChannel.messages.fetch(messageId);
			const thread = await msg.startThread({ name });
			return ok(`Thread created: ${thread.name} (${thread.id})`);
		}
		const thread = await textChannel.threads.create({ name });
		return ok(`Thread created: ${thread.name} (${thread.id})`);
	} catch {
		return fail("Failed to create thread");
	}
};

const sendEmbed: ToolHandler = async (args, ctx) => {
	const title = args.title as string;
	const description = args.description as string | undefined;
	const color = args.color as number | undefined;
	const fields = args.fields as
		| { name: string; value: string; inline?: boolean }[]
		| undefined;
	if (!title) return fail("title is required");
	if (!ctx.channel.isSendable()) return fail("Channel is not sendable");
	await ctx.channel.send({
		embeds: [{ title, description, color, fields }],
	});
	return ok("Embed sent");
};

const pinMessage: ToolHandler = async (args, ctx) => {
	const messageId = args.message_id as string;
	if (!messageId) return fail("message_id is required");
	try {
		const msg = await ctx.channel.messages.fetch(messageId);
		await msg.pin();
		return ok("Message pinned");
	} catch {
		return fail("Failed to pin message");
	}
};

const unpinMessage: ToolHandler = async (args, ctx) => {
	const messageId = args.message_id as string;
	if (!messageId) return fail("message_id is required");
	try {
		const msg = await ctx.channel.messages.fetch(messageId);
		await msg.unpin();
		return ok("Message unpinned");
	} catch {
		return fail("Failed to unpin message");
	}
};

const fetchMessages: ToolHandler = async (args, ctx) => {
	const channelId = (args.channel_id as string | undefined) ?? ctx.channel.id;
	const limit = Math.min((args.limit as number | undefined) ?? 10, 50);
	try {
		const ch = ctx.guild.channels.cache.get(channelId);
		if (!ch || !ch.isTextBased())
			return fail("Channel not found or not text-based");
		const textCh = ch as GuildTextBasedChannel;
		const msgs = await textCh.messages.fetch({ limit });
		const formatted = [...msgs.values()]
			.reverse()
			.map((m) => `[${m.author.displayName}]: ${m.content}`)
			.join("\n");
		return ok(formatted || "(no messages)");
	} catch {
		return fail("Failed to fetch messages");
	}
};

const getChannelInfo: ToolHandler = async (args, ctx) => {
	const channelId = (args.channel_id as string | undefined) ?? ctx.channel.id;
	const ch = ctx.guild.channels.cache.get(channelId);
	if (!ch) return fail("Channel not found");
	const info = {
		id: ch.id,
		name: ch.name,
		type: ChannelType[ch.type],
		topic: "topic" in ch ? ch.topic : null,
	};
	return ok(JSON.stringify(info));
};

const getUserInfo: ToolHandler = async (args, ctx) => {
	const userId = args.user_id as string;
	if (!userId) return fail("user_id is required");
	try {
		const member = await ctx.guild.members.fetch(userId);
		const info = {
			id: member.id,
			username: member.user.username,
			displayName: member.displayName,
			bot: member.user.bot,
			roles: member.roles.cache.map((r) => r.name),
			joinedAt: member.joinedAt?.toISOString(),
		};
		return ok(JSON.stringify(info));
	} catch {
		return fail("Failed to fetch user info");
	}
};

const listChannels: ToolHandler = async (_args, ctx) => {
	const channels = ctx.guild.channels.cache
		.filter((ch) => ch.isTextBased())
		.map((ch) => ({ id: ch.id, name: ch.name, type: ChannelType[ch.type] }));
	return ok(JSON.stringify(channels));
};

const setTyping: ToolHandler = async (_args, ctx) => {
	try {
		if ("sendTyping" in ctx.channel) {
			await (ctx.channel as TextChannel).sendTyping();
			return ok("Typing indicator sent");
		}
		return fail("Channel does not support typing indicator");
	} catch {
		return fail("Failed to send typing indicator");
	}
};

const doNothing: ToolHandler = async (args) => {
	const reasoning = args.reasoning as string;
	return ok(`Decided to do nothing: ${reasoning ?? "no reason given"}`);
};

// ── tool definitions ──

export const discordTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "send_message",
				description:
					"チャンネルにメッセージを送信する。channel_id を指定すると別のチャンネルにも送信可能",
				parameters: {
					type: "object",
					properties: {
						content: { type: "string", description: "送信するメッセージ内容" },
						channel_id: {
							type: "string",
							description: "送信先チャンネルの ID（省略時は現在のチャンネル）",
						},
					},
					required: ["content"],
				},
			},
		},
		handler: sendMessage,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "reply_to_message",
				description:
					"トリガーメッセージに返信する（message.reply() で送信される）",
				parameters: {
					type: "object",
					properties: {
						content: { type: "string", description: "返信するメッセージ内容" },
					},
					required: ["content"],
				},
			},
		},
		handler: replyToMessage,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "add_reaction",
				description: "トリガーメッセージにリアクション絵文字を追加する",
				parameters: {
					type: "object",
					properties: {
						emoji: { type: "string", description: "リアクション絵文字" },
					},
					required: ["emoji"],
				},
			},
		},
		handler: addReaction,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "edit_message",
				description: "bot が送信したメッセージを編集する",
				parameters: {
					type: "object",
					properties: {
						message_id: {
							type: "string",
							description: "編集するメッセージの ID",
						},
						content: { type: "string", description: "新しいメッセージ内容" },
					},
					required: ["message_id", "content"],
				},
			},
		},
		handler: editMessage,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "delete_message",
				description: "bot が送信したメッセージを削除する",
				parameters: {
					type: "object",
					properties: {
						message_id: {
							type: "string",
							description: "削除するメッセージの ID",
						},
					},
					required: ["message_id"],
				},
			},
		},
		handler: deleteMessage,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "create_thread",
				description:
					"スレッドを作成する。message_id を指定するとそのメッセージからスレッドを開始する",
				parameters: {
					type: "object",
					properties: {
						name: { type: "string", description: "スレッド名" },
						message_id: {
							type: "string",
							description: "スレッドを開始するメッセージの ID（省略可）",
						},
					},
					required: ["name"],
				},
			},
		},
		handler: createThread,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "send_embed",
				description: "Embed メッセージを送信する",
				parameters: {
					type: "object",
					properties: {
						title: { type: "string", description: "Embed のタイトル" },
						description: { type: "string", description: "Embed の本文" },
						color: {
							type: "number",
							description: "Embed の色（16進数の数値）",
						},
						fields: {
							type: "array",
							description: "Embed のフィールド配列",
							items: {
								type: "object",
								properties: {
									name: { type: "string" },
									value: { type: "string" },
									inline: { type: "boolean" },
								},
								required: ["name", "value"],
							},
						},
					},
					required: ["title"],
				},
			},
		},
		handler: sendEmbed,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "pin_message",
				description: "メッセージをピンする",
				parameters: {
					type: "object",
					properties: {
						message_id: {
							type: "string",
							description: "ピンするメッセージの ID",
						},
					},
					required: ["message_id"],
				},
			},
		},
		handler: pinMessage,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "unpin_message",
				description: "メッセージのピンを解除する",
				parameters: {
					type: "object",
					properties: {
						message_id: {
							type: "string",
							description: "ピン解除するメッセージの ID",
						},
					},
					required: ["message_id"],
				},
			},
		},
		handler: unpinMessage,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "fetch_messages",
				description: "チャンネルのメッセージ履歴を取得する（最大50件）",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description:
								"取得するチャンネルの ID（省略時は現在のチャンネル）",
						},
						limit: {
							type: "number",
							description: "取得するメッセージ数（デフォルト10、最大50）",
						},
					},
				},
			},
		},
		handler: fetchMessages,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "get_channel_info",
				description: "チャンネルの情報を取得する",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description:
								"取得するチャンネルの ID（省略時は現在のチャンネル）",
						},
					},
				},
			},
		},
		handler: getChannelInfo,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "get_user_info",
				description: "ユーザーの情報を取得する（ロール・表示名など）",
				parameters: {
					type: "object",
					properties: {
						user_id: { type: "string", description: "ユーザー ID" },
					},
					required: ["user_id"],
				},
			},
		},
		handler: getUserInfo,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "list_channels",
				description: "サーバーのテキストチャンネル一覧を取得する",
				parameters: { type: "object", properties: {} },
			},
		},
		handler: listChannels,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "set_typing",
				description: "入力中インジケーターを表示する（考え中であることを示す）",
				parameters: { type: "object", properties: {} },
			},
		},
		handler: setTyping,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "do_nothing",
				description: "何もしないことを選択する。行動しない理由を記録する",
				parameters: {
					type: "object",
					properties: {
						reasoning: {
							type: "string",
							description: "何もしない理由",
						},
					},
					required: ["reasoning"],
				},
			},
		},
		handler: doNothing,
	},
];
