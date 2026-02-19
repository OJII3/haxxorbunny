import { ChannelType, type TextChannel } from "discord.js";
import { runAgentLoop } from "../agent/loop.ts";
import type { AgentContext } from "../agent/types.ts";
import { client } from "../client.ts";
import { getActiveChannelIds } from "../db/queries.ts";
import { getActiveGoals, goalsToPrompt } from "../llm/goals.ts";

export async function checkGoals(): Promise<void> {
	const activeGoals = getActiveGoals();
	if (activeGoals.length === 0) {
		console.log("[goal-check] No active goals, skipping");
		return;
	}

	const guild = client.guilds.cache.first();
	if (!guild) {
		console.log("[goal-check] No guild available");
		return;
	}

	// アクティブなチャンネルを選択
	const activeIds = getActiveChannelIds();
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
		console.log("[goal-check] No text channel available");
		return;
	}

	const goalsSummary = goalsToPrompt();

	const agentCtx: AgentContext = {
		channel,
		guild,
		triggeredBy: "cron",
		goalContext: {
			activeGoalsSummary: goalsSummary,
		},
	};

	await runAgentLoop(agentCtx);
	console.log("[goal-check] Agent loop completed");
}
