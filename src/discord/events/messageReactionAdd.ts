import type {
	MessageReaction,
	PartialMessageReaction,
	PartialUser,
	User,
} from "discord.js";
import { isAgentBusyForGuild } from "../../agent/loop.ts";
import { client } from "../../client.ts";
import { saveBotAction } from "../../db/queries.ts";
import { loadPersonality } from "../../llm/prompts/personality.ts";
import { isPipelineBusy } from "../../pipeline/message-flow.ts";

/** 同一メッセージ+同一ユーザーへの連続反応を防ぐクールダウン (30秒) */
const COOLDOWN_MS = 30_000;
const reactionCooldowns = new Map<string, number>();

/** 同一ユーザーからのリアクション連鎖を防ぐクールダウン (60秒) */
const USER_COOLDOWN_MS = 60_000;
const userCooldowns = new Map<string, number>();

export async function handleMessageReactionAdd(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	// Partial を解決
	if (reaction.partial) {
		try {
			await reaction.fetch();
		} catch (error) {
			console.error("[reaction] Failed to fetch partial reaction:", error);
			return;
		}
	}
	if (reaction.message.partial) {
		try {
			await reaction.message.fetch();
		} catch (error) {
			console.error("[reaction] Failed to fetch partial message:", error);
			return;
		}
	}

	const botUser = client.user;
	if (!botUser) return;

	// bot 自身のリアクションは無視
	if (user.id === botUser.id) return;

	// bot のメッセージへのリアクションのみ反応
	if (reaction.message.author?.id !== botUser.id) return;

	const guild = reaction.message.guild;
	if (!guild) return;

	// busy チェック
	if (isAgentBusyForGuild(guild.id) || isPipelineBusy(guild.id)) return;

	// mood.sociability が低い場合はスキップ
	const personality = loadPersonality();
	if (personality.mood.sociability < 0.3) {
		console.log("[reaction] Skipped: sociability too low");
		return;
	}

	const messageId = reaction.message.id;

	// クールダウンチェック: メッセージ + ユーザーの組み合わせ
	const cooldownKey = `${messageId}:${user.id}`;
	const lastReaction = reactionCooldowns.get(cooldownKey);
	if (lastReaction && Date.now() - lastReaction < COOLDOWN_MS) {
		console.log("[reaction] Cooldown active for message+user:", cooldownKey);
		return;
	}
	reactionCooldowns.set(cooldownKey, Date.now());

	// クールダウンチェック: ユーザー単位
	const userKey = `user:${user.id}`;
	const lastUserReaction = userCooldowns.get(userKey);
	if (lastUserReaction && Date.now() - lastUserReaction < USER_COOLDOWN_MS) {
		console.log("[reaction] User cooldown active for:", userKey);
		return;
	}
	userCooldowns.set(userKey, Date.now());

	// 古いクールダウンエントリを定期的にクリーンアップ
	if (reactionCooldowns.size > 100) {
		const now = Date.now();
		for (const [key, time] of reactionCooldowns) {
			if (now - time > COOLDOWN_MS * 2) {
				reactionCooldowns.delete(key);
			}
		}
	}
	if (userCooldowns.size > 50) {
		const now = Date.now();
		for (const [key, time] of userCooldowns) {
			if (now - time > USER_COOLDOWN_MS * 2) {
				userCooldowns.delete(key);
			}
		}
	}

	const emoji = reaction.emoji.name ?? reaction.emoji.toString();
	const reactorName =
		"displayName" in user
			? (user as User).displayName
			: ((user as PartialUser).username ?? "unknown");
	const messageContent = reaction.message.content ?? "(content unavailable)";

	console.log(
		`[reaction] ${reactorName} reacted with ${emoji} to bot message in #${(reaction.message.channel as { name?: string }).name ?? "unknown"}`,
	);

	const guildId = guild.id;
	const channelId = reaction.message.channel.id;

	// リアクションへの反応は簡易ログのみ
	saveBotAction({
		guildId,
		action: `pipeline:reaction_received:${emoji}`,
		channelId,
		content: messageContent.slice(0, 100),
		reasoning: `${reactorName} reacted with ${emoji}`,
		triggeredBy: "reaction",
	});

	console.log(`[reaction] Logged reaction from ${reactorName}: ${emoji}`);
}
