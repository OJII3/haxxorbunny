import type {
	MessageReaction,
	PartialMessageReaction,
	PartialUser,
	User,
} from "discord.js";
import { isAgentBusyForGuild, runAgentLoop } from "../../agent/loop.ts";
import type { AgentContext } from "../../agent/types.ts";
import { client } from "../../client.ts";
import { loadPersonality } from "../../llm/prompts/personality.ts";

/** 同一メッセージへの連続反応を防ぐクールダウン (30秒) */
const COOLDOWN_MS = 30_000;
const reactionCooldowns = new Map<string, number>();

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

	// エージェントがビジーなら無視
	if (isAgentBusyForGuild(guild.id)) return;

	// mood.sociability が低い場合はスキップ
	const personality = loadPersonality();
	if (personality.mood.sociability < 0.3) {
		console.log("[reaction] Skipped: sociability too low");
		return;
	}

	// クールダウンチェック
	const messageId = reaction.message.id;
	const lastReaction = reactionCooldowns.get(messageId);
	if (lastReaction && Date.now() - lastReaction < COOLDOWN_MS) {
		console.log("[reaction] Cooldown active for message:", messageId);
		return;
	}
	reactionCooldowns.set(messageId, Date.now());

	// 古いクールダウンエントリを定期的にクリーンアップ
	if (reactionCooldowns.size > 100) {
		const now = Date.now();
		for (const [key, time] of reactionCooldowns) {
			if (now - time > COOLDOWN_MS * 2) {
				reactionCooldowns.delete(key);
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

	const agentCtx: AgentContext = {
		triggerMessage: reaction.message.partial ? undefined : reaction.message,
		channel: reaction.message.channel,
		guild,
		triggeredBy: "reaction",
		reactionContext: {
			userName: reactorName,
			emoji,
			messageContent,
		},
	};

	try {
		await runAgentLoop(agentCtx);
	} catch (error) {
		console.error("[reaction] Agent loop error:", error);
	}
}
