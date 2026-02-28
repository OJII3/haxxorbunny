import {
	addReactionCore,
	replyToMessageCore,
	sendMessageCore,
} from "../agent/tools/discord.ts";
import { saveMemoryCore } from "../agent/tools/memory.ts";
import { webSearchCore } from "../agent/tools/web.ts";
import type { ToolResult } from "../agent/types.ts";
import { saveBotAction } from "../db/queries.ts";
import { loadCategories, saveCategories } from "../llm/channel-category.ts";
import { generate } from "./generation.ts";
import { reEvalSearch } from "./search-reeval.ts";
import type {
	ExecutionLog,
	GenerationResult,
	PerceptionResult,
	PipelineContext,
	PlanResult,
} from "./types.ts";

const FALLBACK_PHRASES = [
	"しらん",
	"わからん",
	"むずい",
	"うーん",
	"知らんけど",
	"ふーん",
	"まあいいか",
	"なんだろね",
];

/** give_up 時のフォールバックフレーズをランダム選択 */
function pickFallbackPhrase(): string {
	return FALLBACK_PHRASES[
		Math.floor(Math.random() * FALLBACK_PHRASES.length)
	] as string;
}

/** reply/replyToMessage の分岐を共通化 */
async function sendOrReply(
	text: string,
	perception: PerceptionResult,
	planResult: PlanResult,
	ctx: PipelineContext,
): Promise<ToolResult> {
	if (perception.triggerMessage && !planResult.reply_as_normal) {
		return await replyToMessageCore({
			content: text,
			triggerMessage: perception.triggerMessage,
			guild: ctx.guild,
			channel: ctx.channel,
		});
	}
	return await sendMessageCore({
		content: text,
		channel: ctx.channel,
		guild: ctx.guild,
	});
}

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

				const result = await sendOrReply(
					generated.text,
					perception,
					planResult,
					ctx,
				);
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

				// 検索実行
				const searchResult = await webSearchCore({
					query: planResult.search_query,
				});
				log.actions.push({
					type: "search",
					success: searchResult.success,
					detail: searchResult.result.slice(0, 200),
				});

				// 検索結果の再評価
				const reeval = await reEvalSearch(
					planResult.reply_approach,
					planResult.search_query,
					searchResult.success ? searchResult.result : null,
					perception.content,
				);
				log.actions.push({
					type: "search_reeval",
					success: true,
					detail: `action=${reeval.action}, reasoning=${reeval.reasoning}`,
				});

				switch (reeval.action) {
					case "proceed": {
						const gen = await generate(
							planResult,
							perception,
							ctx,
							searchResult.result,
						);
						const result = await sendOrReply(
							gen.text,
							perception,
							planResult,
							ctx,
						);
						log.actions.push({
							type: "search_reply",
							success: result.success,
							detail: result.result,
						});
						break;
					}

					case "adjust": {
						const adjustedPlan: PlanResult = {
							...planResult,
							reply_approach:
								reeval.adjusted_approach ?? planResult.reply_approach,
						};
						const gen = await generate(
							adjustedPlan,
							perception,
							ctx,
							searchResult.result,
						);
						const result = await sendOrReply(
							gen.text,
							perception,
							planResult,
							ctx,
						);
						log.actions.push({
							type: "search_reply_adjusted",
							success: result.success,
							detail: result.result,
						});
						break;
					}

					case "drop_search": {
						const gen = await generate(planResult, perception, ctx);
						const result = await sendOrReply(
							gen.text,
							perception,
							planResult,
							ctx,
						);
						log.actions.push({
							type: "search_reply_dropped",
							success: result.success,
							detail: result.result,
						});
						break;
					}

					case "give_up": {
						const phrase = pickFallbackPhrase();
						const result = await sendOrReply(
							phrase,
							perception,
							planResult,
							ctx,
						);
						log.actions.push({
							type: "search_reply_giveup",
							success: result.success,
							detail: phrase,
						});
						break;
					}
				}
				break;
			}

			case "categorize": {
				if (!planResult.categorize_category) {
					log.actions.push({
						type: "categorize",
						success: false,
						detail: "No category specified",
					});
					break;
				}
				const targetChannelId =
					planResult.categorize_channel_id ?? ctx.channelId;
				const data = loadCategories(ctx.guildId);
				const targetCat = data.categories.find(
					(c) => c.id === planResult.categorize_category,
				);
				if (!targetCat) {
					log.actions.push({
						type: "categorize",
						success: false,
						detail: `Category not found: ${planResult.categorize_category}`,
					});
					break;
				}
				// 他カテゴリから削除
				for (const cat of data.categories) {
					const idx = cat.channel_ids.indexOf(targetChannelId);
					if (idx !== -1) cat.channel_ids.splice(idx, 1);
				}
				targetCat.channel_ids.push(targetChannelId);
				saveCategories(ctx.guildId, data);
				log.actions.push({
					type: "categorize",
					success: true,
					detail: `Assigned ${targetChannelId} to ${planResult.categorize_category}`,
				});
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
