import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ChannelType, type Guild, type TextChannel } from "discord.js";
import { isAgentBusy, runAgentLoop } from "../agent/loop.ts";
import type { AgentContext } from "../agent/types.ts";
import { client } from "../client.ts";
import { getActiveChannelIds } from "../db/queries.ts";
import { distillDailyMemory } from "../llm/distill.ts";
import { processDream } from "../llm/dream.ts";
import {
	isWithinActiveHours,
	loadHeartbeat,
	markTaskExecuted,
	shouldRunTask,
} from "../llm/heartbeat.ts";

function selectChannel(guild: Guild): TextChannel | undefined {
	const activeIds = getActiveChannelIds();
	for (const id of activeIds) {
		const ch = guild.channels.cache.get(id);
		if (ch?.type === ChannelType.GuildText) {
			return ch as TextChannel;
		}
	}
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

	const agentCtx: AgentContext = {
		channel,
		guild,
		triggeredBy: "cron",
	};

	await runAgentLoop(agentCtx);
	console.log(`[cron] ${guild.name}/#${channel.name} | agent loop completed`);
}

const DAILY_DIR = join(import.meta.dir, "../../data/memory");
const MAX_DAILY_FILES = 30;

function cleanupOldMemory(): void {
	if (!existsSync(DAILY_DIR)) return;

	const files = readdirSync(DAILY_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort();

	if (files.length <= MAX_DAILY_FILES) {
		console.log(
			`[cleanup] ${files.length} daily files, within limit (${MAX_DAILY_FILES})`,
		);
		return;
	}

	const toRemove = files.slice(0, files.length - MAX_DAILY_FILES);
	for (const file of toRemove) {
		const filePath = join(DAILY_DIR, file);
		unlinkSync(filePath);
		console.log(`[cleanup] Removed old daily memory: ${file}`);
	}
	console.log(`[cleanup] Removed ${toRemove.length} old daily files`);
}

async function runHeartbeatTasks(): Promise<void> {
	if (isAgentBusy()) {
		console.log("[heartbeat] Skipped: agent is currently active");
		return;
	}

	const heartbeat = loadHeartbeat();

	for (const task of heartbeat.tasks) {
		if (!shouldRunTask(task)) continue;

		console.log(`[heartbeat] Running task: ${task.id}`);

		try {
			switch (task.id) {
				case "autonomous_post": {
					if (!isWithinActiveHours(heartbeat)) {
						console.log(
							"[heartbeat] autonomous_post skipped: outside active hours",
						);
						break;
					}
					const guilds = client.guilds.cache;
					for (const guild of guilds.values()) {
						await postToGuild(guild);
					}
					break;
				}
				case "distill_memory":
					await distillDailyMemory();
					break;
				case "cleanup_old_memory":
					cleanupOldMemory();
					break;
				case "dream_processing":
					await processDream();
					break;
				default:
					console.warn(`[heartbeat] Unknown task: ${task.id}`);
			}

			markTaskExecuted(heartbeat, task.id);
			console.log(`[heartbeat] Completed task: ${task.id}`);
		} catch (error) {
			console.error(`[heartbeat] Error in task ${task.id}:`, error);
		}
	}
}

export { runHeartbeatTasks };
