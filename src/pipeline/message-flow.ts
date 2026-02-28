import type { Message } from "discord.js";
import { isAgentBusyForGuild } from "../agent/loop.ts";
import {
	getCategoryForChannel,
	getChannelBehavior,
} from "../llm/channel-category.ts";
import { loadGlobalMemory, loadMemory } from "../llm/memory.ts";
import { loadPersonality } from "../llm/prompts/personality.ts";
import {
	lockChannel,
	markChannelResponded,
	unlockChannel,
} from "../llm/triage-throttle.ts";
import { canSendTyping } from "../utils/permissions.ts";
import { execute } from "./execution.ts";
import { generate } from "./generation.ts";
import { perceive } from "./perception.ts";
import { plan } from "./planning.ts";
import { pipelineReflect } from "./reflection.ts";
import { extendedTriage } from "./triage.ts";
import type { PerceptionResult, PipelineContext } from "./types.ts";

// ギルドごとの busy 管理（pipeline 用）
const _pipelineBusyMap = new Map<string, boolean>();

export function isPipelineBusy(guildId: string): boolean {
	return _pipelineBusyMap.get(guildId) === true;
}

/**
 * メッセージ応答パイプラインのオーケストレーター
 * Phase 0 → 1 → 2 → 3 → 4 → 5 をシーケンシャルに実行
 */
export async function runMessageFlow(
	messages: Message[],
	hasMention: boolean,
): Promise<void> {
	// Phase 0: 知覚
	const perception = await perceive(messages, hasMention);
	if (!perception) return;

	const { guildId, channel } = perception;
	const channelId = channel.id;

	// busy チェック（旧エージェントループとの共存用）
	if (isAgentBusyForGuild(guildId) || isPipelineBusy(guildId)) {
		console.log("[pipeline] Busy, skipping");
		return;
	}

	_pipelineBusyMap.set(guildId, true);
	lockChannel(channelId);

	try {
		await _runMessageFlowInner(perception);
	} finally {
		unlockChannel(channelId);
		markChannelResponded(channelId);
		_pipelineBusyMap.set(guildId, false);
	}
}

async function _runMessageFlowInner(
	perception: PerceptionResult,
): Promise<void> {
	const { guildId, guild } = perception;
	const channelId = perception.channel.id;

	// コンテキスト構築
	const personality = loadPersonality();
	const memory = loadMemory(guildId);
	const globalMemory = loadGlobalMemory();
	const channelBehavior = getChannelBehavior(guildId, channelId);
	const channelCategory = getCategoryForChannel(guildId, channelId);

	// triggerMessage は perceive() で常に設定される
	const triggerChannel = perception.triggerMessage?.channel as
		| import("discord.js").TextBasedChannel
		| undefined;

	const ctx: PipelineContext = {
		guild,
		guildId,
		channel:
			triggerChannel ??
			(guild.systemChannel as import("discord.js").TextBasedChannel),
		channelId,
		triggerMessage: perception.triggerMessage,
		isMentioned: perception.isMentioned,
		personality,
		mood: personality.mood,
		memory,
		globalMemory,
		channelBehavior,
		isChannelCategorized: channelCategory !== null,
		channelCategoryId: channelCategory?.id ?? null,
	};

	// typing インジケーター
	const botId = guild.members.me?.id;
	const canType = !!botId && canSendTyping(ctx.channel, botId, guild);
	const sendTypingSafe = () => {
		if (canType) {
			(ctx.channel as { sendTyping: () => Promise<void> })
				.sendTyping()
				.catch((e: unknown) =>
					console.warn("[pipeline] sendTyping failed:", e),
				);
		}
	};

	// Phase 1: 判断
	console.log(
		`[pipeline] Phase 1: Triage for [${perception.author}]: ${perception.content.slice(0, 50)}`,
	);
	const triageResult = await extendedTriage(perception, personality.mood);
	console.log(
		`[pipeline/triage] ${triageResult.action} (${triageResult.confidence}) | intent: ${triageResult.intent} | reason: ${triageResult.reasoning}`,
	);

	// ignore → Phase 5 直行
	if (triageResult.action === "ignore") {
		pipelineReflect(
			guildId,
			perception,
			triageResult,
			null,
			personality.mood,
			`ignore:#${perception.channel.name}`,
		).catch((e) =>
			console.error("[pipeline/reflection] fire-and-forget error:", e),
		);
		return;
	}

	// typing 開始
	if (triageResult.action === "engage") sendTypingSafe();
	const typingInterval =
		triageResult.action === "engage" && canType
			? setInterval(sendTypingSafe, 5_000)
			: null;

	try {
		// Phase 2: 計画
		console.log("[pipeline] Phase 2: Planning");
		const planResult = await plan(triageResult, perception, personality, ctx);
		console.log(
			`[pipeline/planning] actions: ${planResult.actions.join(",")} | approach: ${planResult.reply_approach}`,
		);

		// do_nothing → Phase 5
		if (
			planResult.actions.length === 1 &&
			planResult.actions[0] === "do_nothing"
		) {
			pipelineReflect(
				guildId,
				perception,
				triageResult,
				null,
				personality.mood,
				`do_nothing:#${perception.channel.name}`,
			).catch((e) =>
				console.error("[pipeline/reflection] fire-and-forget error:", e),
			);
			return;
		}

		// Phase 3: 生成（reply / search_then_reply の場合のみ）
		let generated = null;
		const needsGeneration =
			planResult.actions.includes("reply") ||
			planResult.actions.includes("search_then_reply");

		if (needsGeneration && !planResult.actions.includes("search_then_reply")) {
			console.log("[pipeline] Phase 3: Generation");
			generated = await generate(planResult, perception, ctx);
			console.log(
				`[pipeline/generation] text: ${generated.text.slice(0, 100)}`,
			);
		}

		// Phase 4: 実行
		console.log("[pipeline] Phase 4: Execution");
		const executionLog = await execute(planResult, generated, perception, ctx);
		console.log(
			`[pipeline/execution] ${executionLog.actions.map((a) => `${a.type}:${a.success}`).join(", ")}`,
		);

		// Phase 5: 振り返り (fire-and-forget)
		pipelineReflect(
			guildId,
			perception,
			triageResult,
			executionLog,
			personality.mood,
			`pipeline:#${perception.channel.name}`,
		).catch((e) =>
			console.error("[pipeline/reflection] fire-and-forget error:", e),
		);
	} finally {
		if (typingInterval) clearInterval(typingInterval);
	}
}
