import type { TextChannel } from "discord.js";
import { client } from "../client.ts";
import { config } from "../config.ts";
import { saveBotAction, saveMessage } from "../db/queries.ts";
import type { LLMResponse } from "../llm/chat.ts";
import { llm } from "../llm/client.ts";
import {
	loadPersonality,
	personalityToPrompt,
	updatePersonality,
} from "../llm/prompts/personality.ts";
import { SYSTEM_PROMPT } from "../llm/prompts/system.ts";

async function autonomousPost(): Promise<void> {
	const guildId = config.discord.guildId;
	if (!guildId) return;

	const guild = client.guilds.cache.get(guildId);
	if (!guild) return;

	// 最初のテキストチャンネルを取得（将来的に設定可能に）
	const channel = guild.channels.cache.find(
		(ch) => ch.isTextBased() && !ch.isDMBased(),
	) as TextChannel | undefined;
	if (!channel) return;

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
		const parsed = JSON.parse(raw) as LLMResponse;

		if (parsed.action === "message" && parsed.content) {
			await channel.send(parsed.content);
			saveMessage({
				channelId: channel.id,
				userId: client.user?.id ?? "bot",
				username: "haxxerbunny",
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
			`[cron] ${parsed.action} | reason: ${parsed.reasoning ?? "N/A"}`,
		);
	} catch {
		console.error("[cron] Failed to parse LLM response:", raw);
	}
}

export { autonomousPost };
