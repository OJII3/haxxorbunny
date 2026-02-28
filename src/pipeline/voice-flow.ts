import type { Guild, TextBasedChannel } from "discord.js";
import { stripMarkdown } from "../agent/tools/discord.ts";
import type { VoiceContext } from "../agent/types.ts";
import { client } from "../client.ts";
import { config } from "../config.ts";
import { saveBotAction } from "../db/queries.ts";
import { llm } from "../llm/client.ts";
import {
	loadPersonality,
	personalityToPrompt,
} from "../llm/prompts/personality.ts";
import {
	type BotIdentity,
	buildSoul,
	IDENTITY_REMINDER,
} from "../llm/prompts/system.ts";
import { formatJSTShort } from "../utils/time.ts";

/**
 * Voice ショートパス
 * Phase 0 → Phase 3 (直結) → Phase 4 → TTS
 * Phase 1 (Triage) / Phase 2 (Planning) スキップ。レイテンシ最優先
 */
export async function runVoiceFlow(
	voiceContext: VoiceContext,
	guild: Guild,
	textChannel: TextBasedChannel,
): Promise<string | null> {
	const guildId = guild.id;
	const personality = loadPersonality();

	const botUser = client.user;
	const me = guild.members.me;
	const identity: BotIdentity = {
		botUserId: botUser?.id ?? config.discord.appId,
		botUsername: botUser?.username ?? "bot-sekai",
		displayName: me?.displayName ?? botUser?.displayName ?? "世界の泡の住人",
	};

	const soulText = buildSoul(identity);
	const personalityPrompt = personalityToPrompt(personality);

	// トランスクリプト履歴
	const transcriptHistory = voiceContext.recentTranscripts
		.map((t) => {
			const time = formatJSTShort(new Date(t.timestamp));
			return `[${time} ${t.displayName}]: ${t.text}`;
		})
		.join("\n");

	const systemPrompt = `${soulText}\n${personalityPrompt}\n
あなたは今ボイスチャンネル「${voiceContext.voiceChannelName}」で通話中です。
参加者: ${voiceContext.participants.join(", ")}

## ボイスモードのルール
- 短く、テンポよく返す。50文字以内推奨
- 長文禁止。1文で完結
- プレーンテキストのみ
- 返答の必要がない場合は「[skip]」とだけ返す
${IDENTITY_REMINDER}`;

	const messages: Array<{
		role: "system" | "user";
		content: string;
	}> = [{ role: "system", content: systemPrompt }];

	if (transcriptHistory) {
		messages.push({
			role: "user",
			content: `## 直近の会話（音声）\n${transcriptHistory}`,
		});
	}

	try {
		const response = await llm.chat.completions.create({
			model: config.llm.model,
			messages: messages as Parameters<
				typeof llm.chat.completions.create
			>[0]["messages"],
			temperature: 0.6,
			max_tokens: 256,
		});

		const text = response.choices[0]?.message?.content?.trim();
		if (!text || text === "[skip]") {
			saveBotAction({
				guildId,
				action: "pipeline:voice_skip",
				channelId: textChannel.id,
				content: null,
				reasoning: null,
				triggeredBy: "voice",
			});
			return null;
		}

		const cleaned = stripMarkdown(text);

		saveBotAction({
			guildId,
			action: "pipeline:voice_reply",
			channelId: textChannel.id,
			content: cleaned.slice(0, 200),
			reasoning: null,
			triggeredBy: "voice",
		});

		return cleaned;
	} catch (error) {
		console.error("[pipeline/voice-flow] Error:", error);
		return null;
	}
}
