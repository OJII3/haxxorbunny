import {
	ChannelType,
	type Guild,
	PermissionFlagsBits,
	type TextChannel,
} from "discord.js";
import { client } from "../client.ts";
import { getRecentMessages, saveBotAction } from "../db/queries.ts";
import { patrolReflect } from "../llm/reflection.ts";
import { formatJSTShort } from "../utils/time.ts";

/** bot 最終発言から N 分以上経過したチャンネルのみ巡回対象 */
const PATROL_THRESHOLD_MINUTES = 1440; // 24時間

/** 直近の人間メッセージがこれより古いチャンネルは巡回対象外 (ミリ秒) */
const PATROL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7日

/** 1ギルドあたり最大巡回チャンネル数 */
const MAX_PATROL_CHANNELS = 3;

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

		// bot にアクセス権がないチャンネルはスキップ
		const perms = textChannel.permissionsFor(botId);
		if (
			!perms?.has(PermissionFlagsBits.ViewChannel) ||
			!perms?.has(PermissionFlagsBits.ReadMessageHistory)
		) {
			continue;
		}

		try {
			const recentMessages = await textChannel.messages.fetch({ limit: 5 });
			if (recentMessages.size === 0) continue;

			// 直近メッセージの中にbot以外の人間のメッセージがあるか
			const humanMessages = recentMessages.filter((m) => !m.author.bot);
			if (humanMessages.size === 0) continue;

			// 最新の人間メッセージが古すぎる場合はスキップ
			const newestHumanMessage = humanMessages.first();
			if (
				newestHumanMessage &&
				Date.now() - newestHumanMessage.createdTimestamp > PATROL_MAX_AGE_MS
			) {
				continue;
			}

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
 * チャンネル巡回を実行する（観察モード）
 * 全ギルドに対して、bot 発言から一定時間以上経過 + メッセージありのチャンネルから上位3つを選び、
 * patrolReflect で観察（テキスト発言なし、リアクションのみ許可）
 */
export async function patrolChannels(): Promise<void> {
	for (const guild of client.guilds.cache.values()) {
		const candidates = await scanChannelsForGuild(guild);
		if (candidates.length === 0) {
			console.log(`[patrol] ${guild.name}: No channels to patrol`);
			continue;
		}

		// bot が長く不在のチャンネルを優先
		candidates.sort(
			(a, b) => b.minutesSinceLastBotMessage - a.minutesSinceLastBotMessage,
		);

		// 上位 MAX_PATROL_CHANNELS チャンネルを巡回
		const targets = candidates.slice(0, MAX_PATROL_CHANNELS);

		for (const target of targets) {
			console.log(
				`[patrol] Observing ${guild.name}/#${target.channel.name} (${Math.round(target.minutesSinceLastBotMessage)}min since last bot message)`,
			);

			// DB から直近メッセージを取得
			const dbMessages = getRecentMessages(target.channel.id, 20);
			const patrolMessages = dbMessages.map((m) => ({
				username: m.username,
				content: m.content,
				createdAt: m.createdAt ? formatJSTShort(new Date(m.createdAt)) : "?",
				isBot: m.isBot ?? false,
			}));

			const result = await patrolReflect(
				guild.id,
				target.channel.id,
				target.channel.name,
				patrolMessages,
			);

			// リアクションの適用（最大2件、AddReactions 権限がある場合のみ）
			const reactionPerms = target.channel.permissionsFor(
				client.user?.id ?? "",
			);
			if (
				result?.reactions &&
				result.reactions.length > 0 &&
				reactionPerms?.has(PermissionFlagsBits.AddReactions)
			) {
				try {
					const discordMessages = await target.channel.messages.fetch({
						limit: 15,
					});
					const messageArray = [...discordMessages.values()].reverse();

					for (const reaction of result.reactions.slice(0, 2)) {
						const msg = messageArray[reaction.message_index];
						if (msg) {
							try {
								await msg.react(reaction.emoji);
								console.log(
									`[patrol] Reacted ${reaction.emoji} to message by ${msg.author.displayName} in #${target.channel.name}`,
								);
							} catch (e) {
								console.warn(
									`[patrol] Failed to react in #${target.channel.name}:`,
									e,
								);
							}
						}
					}
				} catch (e) {
					console.warn(
						`[patrol] Failed to fetch messages for reactions in #${target.channel.name}:`,
						e,
					);
				}
			}

			// ログ記録
			saveBotAction({
				guildId: guild.id,
				channelId: target.channel.id,
				action: "patrol_observe",
				content: result?.reasoning ?? "no result",
				reasoning: result
					? `reactions: ${result.reactions?.length ?? 0}, memories: ${result.memories?.length ?? 0}, personality: ${result.personality_update ? "updated" : "no change"}`
					: "patrol returned null",
				triggeredBy: "patrol",
			});

			console.log(
				`[patrol] Observation completed for ${guild.name}/#${target.channel.name}`,
			);
		}
	}
}
