import { ChannelType, type TextChannel } from "discord.js";
import { isAgentBusy, runAgentLoop } from "../agent/loop.ts";
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
 * 全テキストチャンネルをスキャンし、巡回対象を選出する
 */
async function scanChannels(): Promise<PatrolCandidate[]> {
	const guild = client.guilds.cache.first();
	if (!guild) return [];

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
 * bot 発言から一定時間以上経過 + メッセージありのチャンネルから上位1つを選び、エージェントループ起動
 */
export async function patrolChannels(): Promise<void> {
	if (isAgentBusy()) {
		console.log("[patrol] Skipped: agent is busy");
		return;
	}

	const candidates = await scanChannels();
	if (candidates.length === 0) {
		console.log("[patrol] No channels to patrol");
		return;
	}

	// bot が長く不在のチャンネルを優先
	candidates.sort(
		(a, b) => b.minutesSinceLastBotMessage - a.minutesSinceLastBotMessage,
	);

	const target = candidates[0];
	if (!target) {
		console.log("[patrol] No candidates after sort");
		return;
	}
	const guild = target.channel.guild;

	console.log(
		`[patrol] Patrolling #${target.channel.name} (${Math.round(target.minutesSinceLastBotMessage)}min since last bot message)`,
	);

	const agentCtx: AgentContext = {
		channel: target.channel,
		guild,
		triggeredBy: "cron",
		patrolContext: {
			channelName: target.channel.name,
			minutesSinceLastBotMessage: Math.round(target.minutesSinceLastBotMessage),
		},
	};

	await runAgentLoop(agentCtx);
	console.log(`[patrol] Patrol completed for #${target.channel.name}`);
}
