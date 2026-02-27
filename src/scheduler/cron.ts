import { existsSync, readdirSync, unlinkSync } from "node:fs";
import {
	ChannelType,
	type Guild,
	PermissionFlagsBits,
	type TextChannel,
} from "discord.js";
import { isAgentBusyForGuild, runAgentLoop } from "../agent/loop.ts";
import type { AgentContext, CustomTaskContext } from "../agent/types.ts";
import { client } from "../client.ts";
import { guildDailyMemoryDir } from "../data/paths.ts";
import { getActiveChannelIds } from "../db/queries.ts";
import { distillDailyMemory } from "../llm/distill.ts";
import { processDream } from "../llm/dream.ts";
import type { HeartbeatTask } from "../llm/heartbeat.ts";
import {
	isWithinActiveHours,
	loadHeartbeat,
	markTaskExecuted,
	shouldRunTask,
} from "../llm/heartbeat.ts";
import { trimGlobalMemory } from "../llm/memory.ts";
import { hasChannelPerms } from "../utils/permissions.ts";

function selectChannel(guild: Guild): TextChannel | undefined {
	const botId = guild.client.user?.id;
	if (!botId) return undefined;
	const activeIds = getActiveChannelIds(guild.id);
	for (const id of activeIds) {
		const ch = guild.channels.cache.get(id);
		if (
			ch?.type === ChannelType.GuildText &&
			hasChannelPerms(
				ch as TextChannel,
				botId,
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.SendMessages,
			)
		) {
			return ch as TextChannel;
		}
	}
	return guild.channels.cache.find(
		(ch) =>
			ch.type === ChannelType.GuildText &&
			hasChannelPerms(
				ch as TextChannel,
				botId,
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.SendMessages,
			),
	) as TextChannel | undefined;
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

const MAX_DAILY_FILES = 30;

function cleanupOldMemory(guildId: string): void {
	const dailyDir = guildDailyMemoryDir(guildId);
	if (!existsSync(dailyDir)) return;

	const files = readdirSync(dailyDir)
		.filter((f) => f.endsWith(".json"))
		.sort();

	if (files.length <= MAX_DAILY_FILES) {
		console.log(
			`[cleanup] ${guildId}: ${files.length} daily files, within limit (${MAX_DAILY_FILES})`,
		);
		return;
	}

	const toRemove = files.slice(0, files.length - MAX_DAILY_FILES);
	for (const file of toRemove) {
		const filePath = `${dailyDir}/${file}`;
		unlinkSync(filePath);
		console.log(`[cleanup] Removed old daily memory: ${file}`);
	}
	console.log(`[cleanup] Removed ${toRemove.length} old daily files`);
}

/** 高頻度タスク群: 13分ごと実行（agentBusy のみチェック） */
const FREQUENT_TASK_IDS = [
	"autonomous_post",
	"channel_patrol",
	"goal_check",
] as const;

/** 低頻度タスク群: 2時間ごと実行（既存のスキップ条件を維持） */
const INFREQUENT_TASK_IDS = [
	"distill_memory",
	"cleanup_old_memory",
	"dream_processing",
] as const;

async function runFrequentTasks(): Promise<void> {
	const heartbeat = loadHeartbeat();

	for (const task of heartbeat.tasks) {
		if (
			!FREQUENT_TASK_IDS.includes(task.id as (typeof FREQUENT_TASK_IDS)[number])
		)
			continue;
		if (!shouldRunTask(task)) continue;

		console.log(`[frequent] Running task: ${task.id}`);

		try {
			switch (task.id) {
				case "autonomous_post": {
					if (!isWithinActiveHours(heartbeat)) {
						console.log(
							"[frequent] autonomous_post skipped: outside active hours",
						);
						break;
					}
					for (const guild of client.guilds.cache.values()) {
						if (isAgentBusyForGuild(guild.id)) {
							console.log(
								`[frequent] autonomous_post skipped for ${guild.name}: agent busy`,
							);
							continue;
						}
						await postToGuild(guild);
					}
					break;
				}
				case "channel_patrol": {
					if (!isWithinActiveHours(heartbeat)) {
						console.log(
							"[frequent] channel_patrol skipped: outside active hours",
						);
						break;
					}
					const { patrolChannels } = await import("./patrol.ts");
					await patrolChannels();
					break;
				}
				case "goal_check": {
					const { checkGoals } = await import("./goal-check.ts");
					await checkGoals();
					break;
				}
				default:
					console.warn(`[frequent] Unknown task: ${task.id}`);
			}

			markTaskExecuted(heartbeat, task.id);
			console.log(`[frequent] Completed task: ${task.id}`);
		} catch (error) {
			console.error(`[frequent] Error in task ${task.id}:`, error);
		}
	}

	// カスタムタスク実行
	for (const task of heartbeat.tasks) {
		if (task.type !== "custom") continue;
		if (!shouldRunTask(task)) continue;

		console.log(`[frequent] Running custom task: ${task.id}`);

		if (
			task.require_active_hours !== false &&
			!isWithinActiveHours(heartbeat)
		) {
			console.log(
				`[frequent] custom task ${task.id} skipped: outside active hours`,
			);
			continue;
		}

		try {
			await runCustomTask(task);
			markTaskExecuted(heartbeat, task.id);
			console.log(`[frequent] Completed custom task: ${task.id}`);
		} catch (error) {
			console.error(`[frequent] Error in custom task ${task.id}:`, error);
		}
	}
}

async function runCustomTask(task: HeartbeatTask): Promise<void> {
	if (!task.prompt) {
		console.warn(`[cron] Custom task ${task.id} has no prompt, skipping`);
		return;
	}

	for (const guild of client.guilds.cache.values()) {
		if (isAgentBusyForGuild(guild.id)) {
			console.log(
				`[cron] custom task ${task.id} skipped for ${guild.name}: agent busy`,
			);
			continue;
		}

		const channel = selectChannel(guild);
		if (!channel) {
			console.log(
				`[cron] custom task ${task.id}: ${guild.name}: テキストチャンネルが見つかりません、スキップ`,
			);
			continue;
		}

		const customTaskContext: CustomTaskContext = {
			taskId: task.id,
			taskDescription: task.description,
			taskPrompt: task.prompt,
		};

		const agentCtx: AgentContext = {
			channel,
			guild,
			triggeredBy: "cron",
			customTaskContext,
		};

		await runAgentLoop(agentCtx);
		console.log(
			`[cron] custom task ${task.id}: ${guild.name}/#${channel.name} | agent loop completed`,
		);
	}
}

async function runInfrequentTasks(): Promise<void> {
	const heartbeat = loadHeartbeat();

	for (const task of heartbeat.tasks) {
		if (
			!INFREQUENT_TASK_IDS.includes(
				task.id as (typeof INFREQUENT_TASK_IDS)[number],
			)
		)
			continue;
		if (!shouldRunTask(task)) continue;

		console.log(`[infrequent] Running task: ${task.id}`);

		try {
			switch (task.id) {
				case "distill_memory":
					for (const guild of client.guilds.cache.values()) {
						await distillDailyMemory(guild.id);
					}
					trimGlobalMemory();
					break;
				case "cleanup_old_memory":
					for (const guild of client.guilds.cache.values()) {
						cleanupOldMemory(guild.id);
					}
					break;
				case "dream_processing":
					for (const guild of client.guilds.cache.values()) {
						await processDream(guild.id);
					}
					break;
				default:
					console.warn(`[infrequent] Unknown task: ${task.id}`);
			}

			markTaskExecuted(heartbeat, task.id);
			console.log(`[infrequent] Completed task: ${task.id}`);
		} catch (error) {
			console.error(`[infrequent] Error in task ${task.id}:`, error);
		}
	}
}

export { runFrequentTasks, runInfrequentTasks };
