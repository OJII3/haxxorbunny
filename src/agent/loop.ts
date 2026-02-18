import type { Message } from "discord.js";
import { client } from "../client.ts";
import { config } from "../config.ts";
import {
	getRecentMessages,
	saveBotAction,
	saveMessage,
} from "../db/queries.ts";
import { llm } from "../llm/client.ts";
import { loadMemory, memoryToPrompt } from "../llm/memory.ts";
import { isDuplicate, recordMessage } from "../llm/message-dedup.ts";
import {
	loadPersonality,
	personalityToPrompt,
} from "../llm/prompts/personality.ts";
import { IDENTITY_PROMPT, SOUL_PROMPT } from "../llm/prompts/system.ts";
import { getToolHandler, toolSpecs } from "./tools/index.ts";
import type { AgentContext } from "./types.ts";

const MAX_ITERATIONS = 5;

let _agentBusy = false;
export function isAgentBusy(): boolean {
	return _agentBusy;
}

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
	_agentBusy = true;
	try {
		return await _runAgentLoopInner(ctx);
	} finally {
		_agentBusy = false;
	}
}

async function _runAgentLoopInner(ctx: AgentContext): Promise<void> {
	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);
	const memory = loadMemory();
	const memoryPrompt = memoryToPrompt(memory);

	// 4層構成: SOUL → IDENTITY → personality → memory
	const systemPrompt = `${SOUL_PROMPT}\n\n${IDENTITY_PROMPT}\n\n${personalityPrompt}\n${memoryPrompt}`;

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
	let messageSent = false;
	let shouldStop = false;

	// エージェントループ
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		if (shouldStop) break;
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

		console.log(
			`[agent] LLM response | finish_reason: ${choice.finish_reason} | content: ${assistantMessage.content?.slice(0, 100) ?? "(null)"} | tool_calls: ${JSON.stringify(assistantMessage.tool_calls ?? [])}`,
		);

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

		// ツール呼び出しがなければ、テキストを send_message で送信（reply ではなく）
		if (functionToolCalls.length === 0) {
			const textContent = assistantMessage.content?.trim();
			if (textContent && !messageSent && ctx.channel.isSendable()) {
				// cron トリガー時は重複チェック
				if (ctx.triggeredBy === "cron" && isDuplicate(textContent)) {
					console.log(
						"[agent] Fallback blocked by dedup:",
						textContent.slice(0, 50),
					);
				} else {
					console.log(
						"[agent] Fallback: sending text as send_message (not reply):",
						textContent.slice(0, 100),
					);
					try {
						await ctx.channel.send(textContent);
						recordMessage(textContent);
						saveMessage({
							channelId: ctx.channel.id,
							userId: client.user?.id ?? "bot",
							username: "haxxorbunny",
							content: textContent,
							isBot: true,
						});
						executedTools.push("send_message(fallback)");
						messageSent = true;
					} catch (e) {
						console.error("[agent] Fallback send failed:", e);
					}
				}
			}
			console.log(
				`[agent] Finished after ${i + 1} iteration(s) (no tool calls)`,
			);
			break;
		}

		// 各ツールを実行
		for (const toolCall of functionToolCalls) {
			const toolName = toolCall.function.name;
			const handler = getToolHandler(toolName);

			const isSendAction =
				toolName === "send_message" || toolName === "reply_to_message";

			let resultText: string;

			// メッセージ送信は1ループにつき1回のみ
			if (isSendAction && messageSent) {
				resultText =
					"Error: Already sent a message in this turn. Use do_nothing to finish.";
				console.warn(`[agent] Blocked duplicate ${toolName}`);
			} else if (!handler) {
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
					if (isSendAction && result.success) {
						messageSent = true;
					}
				} catch (error) {
					resultText = `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
					console.error(`[agent] Tool execution error:`, error);
				}
			}

			// do_nothing が呼ばれたらループ終了
			if (toolName === "do_nothing") {
				shouldStop = true;
			}

			executedTools.push(toolName);

			// ツール結果を履歴に追加
			messages.push({
				role: "tool",
				tool_call_id: toolCall.id,
				content: resultText,
			});
		}

		// メッセージ送信済みなら次のイテレーションで停止
		// （今回のイテレーションで記憶保存も同時に行われるケースに対応）
		if (messageSent) {
			shouldStop = true;
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
