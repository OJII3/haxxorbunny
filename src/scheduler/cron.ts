import { ChannelType, type Guild, type TextChannel } from "discord.js";
import { client } from "../client.ts";
import { config } from "../config.ts";
import {
	getActiveChannelIds,
	saveBotAction,
	saveMessage,
} from "../db/queries.ts";
import type { LLMResponse } from "../llm/chat.ts";
import { llm } from "../llm/client.ts";
import {
	loadPersonality,
	personalityToPrompt,
	updatePersonality,
} from "../llm/prompts/personality.ts";
import { SYSTEM_PROMPT } from "../llm/prompts/system.ts";

function selectChannel(guild: Guild): TextChannel | undefined {
	const activeIds = getActiveChannelIds();
	for (const id of activeIds) {
		const ch = guild.channels.cache.get(id);
		if (ch?.type === ChannelType.GuildText) {
			return ch as TextChannel;
		}
	}
	// フォールバック: Guild 内の最初のテキストチャンネル
	return guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText) as
		| TextChannel
		| undefined;
}

async function postToGuild(guild: Guild): Promise<void> {
	const channel = selectChannel(guild);
	if (!channel) {
		console.log(
			`[cron] ${guild.name}: テキストチャンネルが見つかりません、スキップ`,
		);
		return;
	}

	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);
	const now = new Date();

	const response = await llm.chat.completions.create({
		model: config.llm.model,
		messages: [
			{
				role: "system",
				content: `${SYSTEM_PROMPT}\n\n${personalityPrompt}`,
			},
			{
				role: "user",
				content: `現在時刻: ${now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
何か独り言を言いたいことはありますか？ times チャンネルに投稿するような軽い独り言を考えてください。
特に言いたいことがなければ action: "none" を返してください。`,
			},
		],
		temperature: 0.9,
	});

	const raw = response.choices[0]?.message?.content;
	if (!raw) return;

	try {
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const parsed = JSON.parse(cleaned) as LLMResponse;

		if (parsed.action === "message" && parsed.content) {
			await channel.send(parsed.content);
			saveMessage({
				channelId: channel.id,
				userId: client.user?.id ?? "bot",
				username: "haxxorbunny",
				content: parsed.content,
				isBot: true,
			});
		}

		if (parsed.personality_update) {
			updatePersonality(parsed.personality_update);
			console.log("[cron/personality] Updated:", parsed.personality_update);
		}

		saveBotAction({
			action: parsed.action,
			channelId: channel.id,
			content: parsed.content ?? null,
			reasoning: parsed.reasoning ?? null,
			triggeredBy: "cron",
		});

		console.log(
			`[cron] ${guild.name}/#${channel.name} | ${parsed.action} | reason: ${parsed.reasoning ?? "N/A"}`,
		);
	} catch {
		console.error(
			`[cron] ${guild.name}/#${channel.name} | Failed to parse LLM response:`,
			raw,
		);
	}
}

async function autonomousPost(): Promise<void> {
	const guilds = client.guilds.cache;
	console.log(`[cron] 自主発言チェック開始: ${guilds.size} Guild(s)`);

	for (const guild of guilds.values()) {
		await postToGuild(guild);
	}
}

export { autonomousPost };
