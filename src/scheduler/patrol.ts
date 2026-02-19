import { ChannelType, type Guild, type TextChannel } from "discord.js";
import { isAgentBusyForGuild, runAgentLoop } from "../agent/loop.ts";
import type { AgentContext } from "../agent/types.ts";
import { client } from "../client.ts";

/** bot 最終発言から N 分以上経過したチャンネルのみ巡回対象 */
const PATROL_THRESHOLD_MINUTES = 10;

interface PatrolCandidate {
	channel: TextChannel;
	minutesSinceLastBotMessage: number;
	hasRecentMessages: boolean;
}

/**
 * 指定ギルドの全テキストチャンネルをスキャンし、巡回対象を選出する
 */
async function scanChannelsForGuild(guild: Guild): Promise<PatrolCandidate[]> {
	const botId = client.user?.id;
	if (!botId) return [];

	const candidates: PatrolCandidate[] = [];

	const textChannels = guild.channels.cache.filter(
		(ch) => ch.type === ChannelType.GuildText,
	);

	for (const [, ch] of textChannels) {
		const textChannel = ch as TextChannel;

		try {
			const recentMessages = await textChannel.messages.fetch({ limit: 5 });
			if (recentMessages.size === 0) continue;

			// 直近メッセージの中にbot以外の人間のメッセージがあるか
			const hasHumanMessages = recentMessages.some((m) => !m.author.bot);
			if (!hasHumanMessages) continue;

			// bot の最終発言を探す
			const lastBotMessage = recentMessages.find((m) => m.author.id === botId);

			let minutesSinceLastBot: number;
			if (lastBotMessage) {
				minutesSinceLastBot =
					(Date.now() - lastBotMessage.createdTimestamp) / (1000 * 60);
			} else {
				minutesSinceLastBot = Number.POSITIVE_INFINITY;
			}

			if (minutesSinceLastBot >= PATROL_THRESHOLD_MINUTES) {
				candidates.push({
					channel: textChannel,
					minutesSinceLastBotMessage: minutesSinceLastBot,
					hasRecentMessages: true,
				});
			}
		} catch (error) {
			console.warn(`[patrol] Failed to scan #${textChannel.name}:`, error);
		}
	}

	return candidates;
}

/**
 * チャンネル巡回を実行する
 * 全ギルドに対して、bot 発言から一定時間以上経過 + メッセージありのチャンネルから上位1つを選び、エージェントループ起動
 */
export async function patrolChannels(): Promise<void> {
	for (const guild of client.guilds.cache.values()) {
		if (isAgentBusyForGuild(guild.id)) {
			console.log(`[patrol] Skipped ${guild.name}: agent is busy`);
			continue;
		}

		const candidates = await scanChannelsForGuild(guild);
		if (candidates.length === 0) {
			console.log(`[patrol] ${guild.name}: No channels to patrol`);
			continue;
		}

		// bot が長く不在のチャンネルを優先
		candidates.sort(
			(a, b) => b.minutesSinceLastBotMessage - a.minutesSinceLastBotMessage,
		);

		const target = candidates[0];
		if (!target) continue;

		console.log(
			`[patrol] Patrolling ${guild.name}/#${target.channel.name} (${Math.round(target.minutesSinceLastBotMessage)}min since last bot message)`,
		);

		const agentCtx: AgentContext = {
			channel: target.channel,
			guild,
			triggeredBy: "cron",
			patrolContext: {
				channelName: target.channel.name,
				minutesSinceLastBotMessage: Math.round(
					target.minutesSinceLastBotMessage,
				),
			},
		};

		await runAgentLoop(agentCtx);
		console.log(
			`[patrol] Patrol completed for ${guild.name}/#${target.channel.name}`,
		);
	}
}
