import type { Message } from "discord.js";
import { config } from "../config.ts";
import { getRecentMessages, saveBotAction } from "../db/queries.ts";
import { llm } from "../llm/client.ts";
import { loadMemory, memoryToPrompt } from "../llm/memory.ts";
import {
	loadPersonality,
	personalityToPrompt,
} from "../llm/prompts/personality.ts";
import { SYSTEM_PROMPT } from "../llm/prompts/system.ts";
import { getToolHandler, toolSpecs } from "./tools/index.ts";
import type { AgentContext } from "./types.ts";

const MAX_ITERATIONS = 5;

interface ConversationMessage {
	role: "user" | "assistant";
	content: string;
}

function buildConversationHistory(messages: Message[]): ConversationMessage[] {
	return messages.map((msg) => ({
		role: (msg.author.bot ? "assistant" : "user") as "user" | "assistant",
		content: `[${msg.author.displayName}]: ${msg.content}`,
	}));
}

/** エージェントループ本体 */
export async function runAgentLoop(ctx: AgentContext): Promise<void> {
	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);
	const memory = loadMemory();
	const memoryPrompt = memoryToPrompt(memory);

	const systemPrompt = `${SYSTEM_PROMPT}\n\n${personalityPrompt}\n${memoryPrompt}`;

	// 会話履歴を構築
	const messages: Array<{
		role: "system" | "user" | "assistant" | "tool";
		content: string | null;
		tool_calls?: Array<{
			id: string;
			type: "function";
			function: { name: string; arguments: string };
		}>;
		tool_call_id?: string;
		name?: string;
	}> = [{ role: "system", content: systemPrompt }];

	if (ctx.triggerMessage) {
		// メッセージトリガー: 直近の会話履歴 + トリガーメッセージ
		const recentMessages = await ctx.triggerMessage.channel.messages.fetch({
			limit: 20,
		});
		const history = buildConversationHistory(
			[...recentMessages.values()].reverse(),
		);
		for (const msg of history) {
			messages.push(msg);
		}
		messages.push({
			role: "user",
			content: `[${ctx.triggerMessage.author.displayName}]: ${ctx.triggerMessage.content}`,
		});
	} else {
		// cron トリガー: 自主発言コンテキスト
		const dbMessages = getRecentMessages(ctx.channel.id, 10);
		if (dbMessages.length > 0) {
			const history = dbMessages
				.map((m) => `[${m.username}]: ${m.content}`)
				.join("\n");
			messages.push({
				role: "user",
				content: `## 直近の会話\n${history}`,
			});
		}
		const now = new Date();
		messages.push({
			role: "user",
			content: `現在時刻: ${now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
何か独り言を言いたいことはありますか？ times チャンネルに投稿するような軽い独り言を考えてください。
特に言いたいことがなければ do_nothing ツールを呼んでください。`,
		});
	}

	const executedTools: string[] = [];

	// エージェントループ
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const response = await llm.chat.completions.create({
			model: config.llm.model,
			messages: messages as Parameters<
				typeof llm.chat.completions.create
			>[0]["messages"],
			tools: toolSpecs,
			temperature: 0.8,
		});

		const choice = response.choices[0];
		if (!choice) {
			console.error("[agent] No choice in LLM response");
			break;
		}

		const assistantMessage = choice.message;

		// function tool_calls のみフィルタリング（custom tool は無視）
		const functionToolCalls =
			assistantMessage.tool_calls?.filter(
				(
					tc,
				): tc is typeof tc & {
					type: "function";
					function: { name: string; arguments: string };
				} => tc.type === "function",
			) ?? [];

		// アシスタントメッセージを履歴に追加
		messages.push({
			role: "assistant",
			content: assistantMessage.content,
			tool_calls:
				functionToolCalls.length > 0
					? functionToolCalls.map((tc) => ({
							id: tc.id,
							type: "function" as const,
							function: {
								name: tc.function.name,
								arguments: tc.function.arguments,
							},
						}))
					: undefined,
		});

		// ツール呼び出しがなければ終了
		if (functionToolCalls.length === 0) {
			console.log(
				`[agent] Finished after ${i + 1} iteration(s) (no tool calls)`,
			);
			break;
		}

		// 各ツールを実行
		for (const toolCall of functionToolCalls) {
			const toolName = toolCall.function.name;
			const handler = getToolHandler(toolName);

			let resultText: string;
			if (!handler) {
				resultText = `Error: Unknown tool "${toolName}"`;
				console.error(`[agent] Unknown tool: ${toolName}`);
			} else {
				try {
					const args = JSON.parse(toolCall.function.arguments) as Record<
						string,
						unknown
					>;
					console.log(`[agent] Calling tool: ${toolName}`, args);
					const result = await handler(args, ctx);
					resultText = result.result;
					if (!result.success) {
						console.warn(`[agent] Tool ${toolName} failed: ${resultText}`);
					}
				} catch (error) {
					resultText = `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
					console.error(`[agent] Tool execution error:`, error);
				}
			}

			executedTools.push(toolName);

			// ツール結果を履歴に追加
			messages.push({
				role: "tool",
				tool_call_id: toolCall.id,
				content: resultText,
			});
		}
	}

	// bot_actions ログに記録
	const toolsSummary =
		executedTools.length > 0 ? executedTools.join(",") : "none";
	saveBotAction({
		action: `agent:${toolsSummary}`,
		channelId: ctx.channel.id,
		content: null,
		reasoning: null,
		triggeredBy: ctx.triggeredBy,
	});

	console.log(
		`[agent] Loop complete | tools: ${toolsSummary} | trigger: ${ctx.triggeredBy}`,
	);
}
