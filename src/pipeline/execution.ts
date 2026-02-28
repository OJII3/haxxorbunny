import {
	addReactionCore,
	replyToMessageCore,
	sendMessageCore,
} from "../agent/tools/discord.ts";
import { saveMemoryCore } from "../agent/tools/memory.ts";
import { webSearchCore } from "../agent/tools/web.ts";
import type { ToolResult } from "../agent/types.ts";
import { saveBotAction } from "../db/queries.ts";
import { generate } from "./generation.ts";
import type {
	ExecutionLog,
	GenerationResult,
	PerceptionResult,
	PipelineContext,
	PlanResult,
} from "./types.ts";

/**
 * Phase 4: 実行
 * plan 結果からコア関数を直接呼び出す
 */
export async function execute(
	planResult: PlanResult,
	generated: GenerationResult | null,
	perception: PerceptionResult,
	ctx: PipelineContext,
): Promise<ExecutionLog> {
	const log: ExecutionLog = {
		actions: [],
		timestamp: new Date().toISOString(),
	};

	for (const action of planResult.actions) {
		switch (action) {
			case "reply": {
				if (!generated) {
					log.actions.push({
						type: "reply",
						success: false,
						detail: "No generated text",
					});
					break;
				}

				let result: ToolResult;
				if (perception.triggerMessage) {
					result = await replyToMessageCore({
						content: generated.text,
						triggerMessage: perception.triggerMessage,
						guild: ctx.guild,
						channel: ctx.channel,
					});
				} else {
					result = await sendMessageCore({
						content: generated.text,
						channel: ctx.channel,
						guild: ctx.guild,
					});
				}
				log.actions.push({
					type: "reply",
					success: result.success,
					detail: result.result,
				});
				break;
			}

			case "react": {
				if (!planResult.react_emoji || !perception.triggerMessage) {
					log.actions.push({
						type: "react",
						success: false,
						detail: "No emoji or trigger message",
					});
					break;
				}
				const result = await addReactionCore({
					emoji: planResult.react_emoji,
					triggerMessage: perception.triggerMessage,
				});
				log.actions.push({
					type: "react",
					success: result.success,
					detail: result.result,
				});
				break;
			}

			case "memorize": {
				if (!planResult.memo) {
					log.actions.push({
						type: "memorize",
						success: false,
						detail: "No memo content",
					});
					break;
				}
				const result = await saveMemoryCore({
					guildId: ctx.guildId,
					entry: planResult.memo,
					emotionalImpact: planResult.memo_impact,
					isMentioned: perception.isMentioned,
				});
				log.actions.push({
					type: "memorize",
					success: result.success,
					detail: result.result,
				});
				break;
			}

			case "search_then_reply": {
				if (!planResult.search_query) {
					log.actions.push({
						type: "search_then_reply",
						success: false,
						detail: "No search query",
					});
					break;
				}
				const searchResult = await webSearchCore({
					query: planResult.search_query,
				});
				log.actions.push({
					type: "search",
					success: searchResult.success,
					detail: searchResult.result.slice(0, 200),
				});

				if (searchResult.success) {
					// 検索結果をもとに生成
					const searchGenerated = await generate(
						planResult,
						perception,
						ctx,
						searchResult.result,
					);
					// 送信
					let sendResult: ToolResult;
					if (perception.triggerMessage) {
						sendResult = await replyToMessageCore({
							content: searchGenerated.text,
							triggerMessage: perception.triggerMessage,
							guild: ctx.guild,
							channel: ctx.channel,
						});
					} else {
						sendResult = await sendMessageCore({
							content: searchGenerated.text,
							channel: ctx.channel,
							guild: ctx.guild,
						});
					}
					log.actions.push({
						type: "search_reply",
						success: sendResult.success,
						detail: sendResult.result,
					});
				}
				break;
			}

			case "do_nothing": {
				log.actions.push({
					type: "do_nothing",
					success: true,
					detail: "Decided to do nothing",
				});
				break;
			}
		}
	}

	// bot_actions ログに記録
	const actionsSummary = log.actions.map((a) => a.type).join(",") || "none";
	saveBotAction({
		guildId: ctx.guildId,
		action: `pipeline:${actionsSummary}`,
		channelId: ctx.channelId,
		content: generated?.text?.slice(0, 200) ?? null,
		reasoning: null,
		triggeredBy: "triage",
	});

	return log;
}
