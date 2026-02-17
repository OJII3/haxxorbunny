import type { Message } from "discord.js";
import { client } from "../../client.ts";
import { chat } from "../../llm/chat.ts";

function shouldRespond(message: Message): boolean {
	if (message.author.bot) return false;

	const botUser = client.user;
	if (!botUser) return false;

	// メンションされた場合
	if (message.mentions.has(botUser)) return true;

	// bot の名前が含まれている場合
	const lowerContent = message.content.toLowerCase();
	if (lowerContent.includes("haxxerbunny")) return true;

	return false;
}

async function fetchRecentMessages(message: Message): Promise<Message[]> {
	const fetched = await message.channel.messages.fetch({ limit: 20 });
	return [...fetched.values()].reverse();
}

export async function handleMessageCreate(message: Message): Promise<void> {
	if (!shouldRespond(message)) return;

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
	} catch (error) {
		console.error("[messageCreate] Error:", error);
	}
}
