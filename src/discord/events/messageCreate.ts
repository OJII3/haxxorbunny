import type { Message } from "discord.js";
import { client } from "../../client.ts";
import { saveBotAction, saveMessage } from "../../db/queries.ts";
import { chat } from "../../llm/chat.ts";

function shouldRespond(message: Message): boolean {
	if (message.author.bot) return false;

	const botUser = client.user;
	if (!botUser) return false;

	if (message.mentions.has(botUser)) return true;

	const lowerContent = message.content.toLowerCase();
	if (lowerContent.includes("haxxerbunny")) return true;

	return false;
}

async function fetchRecentMessages(message: Message): Promise<Message[]> {
	const fetched = await message.channel.messages.fetch({ limit: 20 });
	return [...fetched.values()].reverse();
}

export async function handleMessageCreate(message: Message): Promise<void> {
	// すべてのメッセージを DB に保存
	saveMessage({
		channelId: message.channelId,
		userId: message.author.id,
		username: message.author.displayName,
		content: message.content,
		isBot: message.author.bot,
	});

	if (!shouldRespond(message)) {
		// 5% の確率でランダムリアクション
		if (!message.author.bot && Math.random() < 0.05) {
			const emojis = ["👀", "🐰", "✨", "🤔", "💻", "🔥", "👍"];
			const emoji = emojis[Math.floor(Math.random() * emojis.length)];
			if (emoji) {
				await message.react(emoji).catch(() => {});
				saveBotAction({
					action: "reaction",
					channelId: message.channelId,
					content: emoji,
					reasoning: "Random reaction",
					triggeredBy: "random",
				});
			}
		}
		return;
	}

	try {
		const recentMessages = await fetchRecentMessages(message);
		const response = await chat(message, recentMessages);

		console.log(
			`[action] ${response.action} | reason: ${response.reasoning ?? "N/A"}`,
		);

		switch (response.action) {
			case "message":
				if (response.content && message.channel.isSendable()) {
					await message.channel.send(response.content);
					saveMessage({
						channelId: message.channelId,
						userId: client.user?.id ?? "bot",
						username: "haxxerbunny",
						content: response.content,
						isBot: true,
					});
				}
				break;
			case "reaction":
				if (response.emoji) {
					await message.react(response.emoji);
				}
				break;
			case "none":
				break;
		}

		saveBotAction({
			action: response.action,
			channelId: message.channelId,
			content: response.content ?? null,
			reasoning: response.reasoning ?? null,
			triggeredBy: "mention",
		});
	} catch (error) {
		console.error("[messageCreate] Error:", error);
	}
}
