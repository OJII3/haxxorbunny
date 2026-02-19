import { ChannelType, type TextChannel } from "discord.js";
import { isAgentBusyForGuild, runAgentLoop } from "../agent/loop.ts";
import type { AgentContext } from "../agent/types.ts";
import { client } from "../client.ts";
import { getActiveChannelIds } from "../db/queries.ts";
import { getActiveGoals, goalsToPrompt } from "../llm/goals.ts";

export async function checkGoals(): Promise<void> {
	for (const guild of client.guilds.cache.values()) {
		const activeGoals = getActiveGoals(guild.id);
		if (activeGoals.length === 0) {
			console.log(`[goal-check] ${guild.name}: No active goals, skipping`);
			continue;
		}

		if (isAgentBusyForGuild(guild.id)) {
			console.log(`[goal-check] ${guild.name}: Agent is busy, skipping`);
			continue;
		}

		// アクティブなチャンネルを選択
		const activeIds = getActiveChannelIds(guild.id);
		let channel: TextChannel | undefined;
		for (const id of activeIds) {
			const ch = guild.channels.cache.get(id);
			if (ch?.type === ChannelType.GuildText) {
				channel = ch as TextChannel;
				break;
			}
		}

		if (!channel) {
			channel = guild.channels.cache.find(
				(ch) => ch.type === ChannelType.GuildText,
			) as TextChannel | undefined;
		}

		if (!channel) {
			console.log(`[goal-check] ${guild.name}: No text channel available`);
			continue;
		}

		const goalsSummary = goalsToPrompt(guild.id);

		const agentCtx: AgentContext = {
			channel,
			guild,
			triggeredBy: "cron",
			goalContext: {
				activeGoalsSummary: goalsSummary,
			},
		};

		await runAgentLoop(agentCtx);
		console.log(`[goal-check] ${guild.name}: Agent loop completed`);
	}
}
