import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import { distillDailyMemory } from "../llm/distill.ts";
import {
	loadHeartbeat,
	markTaskExecuted,
	shouldRunTask,
} from "../llm/heartbeat.ts";
import {
	addUserNote,
	appendMemoryEntry,
	loadMemory,
	memoryToPrompt,
} from "../llm/memory.ts";
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
	return guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText) as
		| TextChannel
		| undefined;
}

function processMemoryFields(parsed: LLMResponse): void {
	if (parsed.memory_entry) {
		appendMemoryEntry(parsed.memory_entry);
	}
	if (parsed.user_note) {
		const colonIndex = parsed.user_note.indexOf(":");
		if (colonIndex > 0) {
			const username = parsed.user_note.slice(0, colonIndex).trim();
			const note = parsed.user_note.slice(colonIndex + 1).trim();
			if (username && note) {
				addUserNote(username, note);
			}
		}
	}
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
	const memory = loadMemory();
	const memoryPrompt = memoryToPrompt(memory);
	const now = new Date();

	const response = await llm.chat.completions.create({
		model: config.llm.model,
		messages: [
			{
				role: "system",
				content: `${SYSTEM_PROMPT}\n\n${personalityPrompt}\n${memoryPrompt}`,
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

		processMemoryFields(parsed);

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
		Bun.file(filePath).delete();
		console.log(`[cleanup] Removed old daily memory: ${file}`);
	}
	console.log(`[cleanup] Removed ${toRemove.length} old daily files`);
}

async function runHeartbeatTasks(): Promise<void> {
	const heartbeat = loadHeartbeat();

	for (const task of heartbeat.tasks) {
		if (!shouldRunTask(task)) continue;

		console.log(`[heartbeat] Running task: ${task.id}`);

		try {
			switch (task.id) {
				case "autonomous_post": {
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

export { runHeartbeatTasks as autonomousPost };
