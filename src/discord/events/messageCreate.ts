import type { Message } from "discord.js";
import { client } from "../../client.ts";
import { saveBotAction, saveMessage } from "../../db/queries.ts";
import { chat } from "../../llm/chat.ts";
import { triage } from "../../llm/triage.ts";
import { shouldThrottle } from "../../llm/triage-throttle.ts";

function isMentioned(message: Message): boolean {
	const botUser = client.user;
	if (!botUser) return false;

	if (message.mentions.has(botUser)) return true;

	const lowerContent = message.content.toLowerCase();
	if (lowerContent.includes("haxxorbunny")) return true;

	return false;
}

async function fetchRecentMessages(message: Message): Promise<Message[]> {
	const fetched = await message.channel.messages.fetch({ limit: 20 });
	return [...fetched.values()].reverse();
}

async function handleMainLLM(
	message: Message,
	triggeredBy: string,
): Promise<void> {
	const recentMessages = await fetchRecentMessages(message);
	const response = await chat(message, recentMessages);

	console.log(
		`[action] ${response.action} | trigger: ${triggeredBy} | reason: ${response.reasoning ?? "N/A"}`,
	);

	switch (response.action) {
		case "reply":
			if (response.content) {
				await message.reply(response.content);
				saveMessage({
					channelId: message.channelId,
					userId: client.user?.id ?? "bot",
					username: "haxxorbunny",
					content: response.content,
					isBot: true,
				});
			}
			break;
		case "message":
			if (response.content && message.channel.isSendable()) {
				await message.channel.send(response.content);
				saveMessage({
					channelId: message.channelId,
					userId: client.user?.id ?? "bot",
					username: "haxxorbunny",
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
		triggeredBy,
	});
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

	// Bot のメッセージは無視
	if (message.author.bot) return;

	const mentioned = isMentioned(message);

	// スロットル判定（メンション時はバイパス）
	if (!mentioned && shouldThrottle(message.channelId)) {
		return;
	}

	// 全メッセージ → トリアージ → アクション実行
	try {
		const triageResult = await triage(
			message.channelId,
			message.content,
			message.author.displayName,
			mentioned,
		);

		console.log(
			`[triage] ${triageResult.action} (${triageResult.confidence}) | reason: ${triageResult.reasoning}`,
		);

		switch (triageResult.action) {
			case "ignore":
				break;

			case "reaction":
				if (triageResult.emoji) {
					await message.react(triageResult.emoji).catch(() => {});
					saveBotAction({
						action: "reaction",
						channelId: message.channelId,
						content: triageResult.emoji,
						reasoning: triageResult.reasoning,
						triggeredBy: "triage",
					});
				}
				break;

			case "reply":
			case "message":
				await handleMainLLM(message, "triage");
				break;
		}
	} catch (error) {
		console.error("[messageCreate] Triage handler error:", error);
	}
}
