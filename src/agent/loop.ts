import type { Message } from "discord.js";
import { client } from "../client.ts";
import { config } from "../config.ts";
import {
	getRecentMessages,
	saveBotAction,
	saveMessage,
} from "../db/queries.ts";
import { llm } from "../llm/client.ts";
import { goalsToPrompt } from "../llm/goals.ts";
import { loadMemory, memoryToPrompt } from "../llm/memory.ts";
import { isDuplicate, recordMessage } from "../llm/message-dedup.ts";
import {
	loadPersonality,
	personalityToPrompt,
} from "../llm/prompts/personality.ts";
import { SURFACE_PROMPT } from "../llm/prompts/system.ts";
import {
	lockChannel,
	markChannelResponded,
	unlockChannel,
} from "../llm/triage-throttle.ts";
import {
	getToolHandler,
	inferToolNameFromArgs,
	toolSpecs,
	voiceToolSpecs,
} from "./tools/index.ts";
import type { AgentContext } from "./types.ts";

const MAX_ITERATIONS = 10;

/**
 * tool_call の arguments をパースする。
 * LLM が複数の JSON オブジェクトを連結して返すケースに対応し、
 * 先頭の有効な JSON オブジェクトのみを抽出する。
 * （連結 JSON の全展開はエージェントループ側で parseAllJsonObjects を使用）
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
	const validate = (parsed: unknown): Record<string, unknown> => {
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new SyntaxError(
				`Invalid tool arguments: expected object, got ${typeof parsed}`,
			);
		}
		return parsed as Record<string, unknown>;
	};

	try {
		return validate(JSON.parse(raw));
	} catch (e) {
		if (
			e instanceof SyntaxError &&
			e.message.startsWith("Invalid tool arguments:")
		) {
			throw e;
		}
		// 連結 JSON フォールバック: parseAllJsonObjects に委譲
		const objects = parseAllJsonObjects(raw);
		if (objects.length > 0 && objects[0]) {
			if (objects.length > 1) {
				console.warn(
					`[agent] Malformed tool arguments (concatenated JSON), using first object only. raw=${raw.slice(0, 500)}`,
				);
			}
			return validate(objects[0]);
		}
		throw new SyntaxError(`Invalid tool arguments: ${raw}`);
	}
}

/**
 * 連結 JSON 文字列から全 JSON オブジェクトを抽出する。
 * 正常な単一 JSON はそのまま 1 要素の配列として返す。
 */
export function parseAllJsonObjects(raw: string): Record<string, unknown>[] {
	// まず通常のパースを試す
	try {
		const parsed = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return [parsed as Record<string, unknown>];
		}
		return [];
	} catch {
		// 連結 JSON の可能性 → フォールバック
	}

	if (!raw.startsWith("{")) return [];

	const objects: Record<string, unknown>[] = [];
	let pos = 0;

	while (pos < raw.length) {
		// 次の '{' を探す
		while (pos < raw.length && raw[pos] !== "{") pos++;
		if (pos >= raw.length) break;

		// ブレース深度でオブジェクト境界を検出
		let depth = 0;
		let inString = false;
		let escaped = false;
		const start = pos;
		let found = false;

		for (let i = start; i < raw.length; i++) {
			const ch = raw[i];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\" && inString) {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (ch === "{") depth++;
			if (ch === "}") {
				depth--;
				if (depth === 0) {
					const objStr = raw.slice(start, i + 1);
					try {
						const parsed = JSON.parse(objStr);
						if (
							typeof parsed === "object" &&
							parsed !== null &&
							!Array.isArray(parsed)
						) {
							objects.push(parsed as Record<string, unknown>);
						}
					} catch {
						// skip invalid JSON fragment
					}
					pos = i + 1;
					found = true;
					break;
				}
			}
		}

		// depth が 0 に戻らなかった場合は終了
		if (!found) break;
	}

	return objects;
}

const _agentBusyMap = new Map<string, boolean>();

export function isAgentBusy(): boolean {
	return [..._agentBusyMap.values()].some(Boolean);
}

export function isAgentBusyForGuild(guildId: string): boolean {
	return _agentBusyMap.get(guildId) === true;
}

let _lastActivityAt = 0;

/** メッセージ受信やエージェント実行時にアクティビティを記録する */
export function markActivity(): void {
	_lastActivityAt = Date.now();
}

/** 直近 minutes 分以内にアクティビティがあったかどうか */
export function hasRecentActivity(minutes = 5): boolean {
	if (_lastActivityAt === 0) return false;
	return Date.now() - _lastActivityAt < minutes * 60 * 1000;
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
	const channelId = ctx.channel.id;
	const guildId = ctx.guild.id;
	_agentBusyMap.set(guildId, true);
	lockChannel(channelId);
	try {
		return await _runAgentLoopInner(ctx);
	} finally {
		unlockChannel(channelId);
		markChannelResponded(channelId);
		_agentBusyMap.set(guildId, false);
	}
}

async function _runAgentLoopInner(ctx: AgentContext): Promise<void> {
	// typing インジケーター: LLM 応答中にユーザーへ「入力中…」を表示
	const sendTypingSafe = () => {
		if ("sendTyping" in ctx.channel) {
			(ctx.channel as { sendTyping: () => Promise<void> })
				.sendTyping()
				.catch((e) => console.warn("[agent] sendTyping failed:", e));
		}
	};
	sendTypingSafe();
	const typingInterval = setInterval(sendTypingSafe, 5_000);

	try {
		return await _runAgentLoopBody(ctx);
	} finally {
		clearInterval(typingInterval);
	}
}

async function _runAgentLoopBody(ctx: AgentContext): Promise<void> {
	const guildId = ctx.guild.id;
	const personality = loadPersonality(guildId);
	const personalityPrompt = personalityToPrompt(personality);
	const memory = loadMemory(guildId);
	const memoryPrompt = memoryToPrompt(memory);

	// 軽量構成: SURFACE → personality → memory (詳細は recall_identity ツールで参照)
	const systemPrompt = `${SURFACE_PROMPT}\n\n${personalityPrompt}\n${memoryPrompt}`;

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

	const isVoiceMode = ctx.triggeredBy === "voice";

	if (isVoiceMode && ctx.voiceContext) {
		// ボイスチャットトリガー
		const vc = ctx.voiceContext;
		const transcriptHistory = vc.recentTranscripts
			.map((t) => `[${t.displayName}]: ${t.text}`)
			.join("\n");

		messages.push({
			role: "system",
			content: `あなたは今ボイスチャンネル「${vc.voiceChannelName}」で通話中です。
参加者: ${vc.participants.join(", ")}

【ボイスモードのルール】
- voice_reply ツールで音声として返答する（50文字以内推奨）
- 短く、テンポよく返す。長文禁止
- 退出したい場合は leave_voice
- 何もしない場合は do_nothing`,
		});

		if (transcriptHistory) {
			messages.push({
				role: "user",
				content: `## 直近の会話（音声）\n${transcriptHistory}`,
			});
		}
	} else if (ctx.triggerMessage && ctx.triggeredBy === "triage") {
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
		if (ctx.isMentioned) {
			messages.push({
				role: "system",
				content:
					"【重要】このメッセージはあなたへのメンション（直接の呼びかけ）です。" +
					"指示・依頼・約束が含まれている場合は、必ず save_memory で記憶に保存してください（emotional_impact は 4 以上推奨）。" +
					"既に覚えていることでも、改めて念押しされた場合は上書き保存してください。",
			});
		}
	} else if (ctx.reactionContext) {
		// リアクショントリガー
		const dbMessages = getRecentMessages(ctx.channel.id, 5);
		if (dbMessages.length > 0) {
			const history = dbMessages
				.map((m) => `[${m.username}]: ${m.content}`)
				.join("\n");
			messages.push({
				role: "user",
				content: `## 直近の会話\n${history}`,
			});
		}
		messages.push({
			role: "user",
			content: `${ctx.reactionContext.userName} があなたのメッセージ「${ctx.reactionContext.messageContent}」に ${ctx.reactionContext.emoji} でリアクションしました。
何か反応したいことがあればどうぞ。特になければ do_nothing を呼んでください。`,
		});
	} else if (ctx.patrolContext) {
		// チャンネル巡回トリガー
		const dbMessages = getRecentMessages(ctx.channel.id, 15);
		if (dbMessages.length > 0) {
			const history = dbMessages
				.map((m) => `[${m.username}]: ${m.content}`)
				.join("\n");
			messages.push({
				role: "user",
				content: `## #${ctx.patrolContext.channelName} の直近の会話\n${history}`,
			});
		}
		messages.push({
			role: "user",
			content: `あなたはこのチャンネル (#${ctx.patrolContext.channelName}) を ${ctx.patrolContext.minutesSinceLastBotMessage} 分間見ていませんでした。
会話を読んで、反応したいことがあればどうぞ（コメント、リアクション、質問など）。
特に言うことがなければ do_nothing を呼んでください。無理に会話に入る必要はありません。`,
		});
	} else if (ctx.goalContext) {
		// ゴールチェックトリガー
		const dbMessages = getRecentMessages(ctx.channel.id, 5);
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

${ctx.goalContext.activeGoalsSummary}

目標に向けて何かアクションを取りたいですか？ web_search で情報を調べたり、send_message で誰かに聞いたり、update_goal_progress でメモを残したりできます。
特にやることがなければ do_nothing を呼んでください。`,
		});
	} else {
		// cron 自主発言トリガー（デフォルト）
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

		const goalsPrompt = goalsToPrompt(guildId);
		const now = new Date();
		messages.push({
			role: "user",
			content: `現在時刻: ${now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
${goalsPrompt ? `\n${goalsPrompt}\n` : ""}
自由行動タイム！やりたいことを選んでください:
- 独り言を投稿する（times チャンネルに投稿するような軽い独り言）
- web_search で気になることを調べる
- list_channels で他のチャンネルを見に行く
- 目標があれば進捗を確認・更新する
- 特に何もなければ do_nothing

何をしますか？`,
		});
	}

	const executedTools: string[] = [];
	let messageSent = false;
	let shouldStop = false;

	// voice モード: イテレーション数とパラメータを調整
	const maxIter = isVoiceMode ? 3 : MAX_ITERATIONS;
	const temperature = isVoiceMode ? 0.6 : 0.8;
	const activeToolSpecs = isVoiceMode ? voiceToolSpecs : toolSpecs;

	// エージェントループ
	for (let i = 0; i < maxIter; i++) {
		if (shouldStop) break;
		// ストリーミングでレスポンスを取得し、チャンクから組み立てる
		const stream = await llm.chat.completions.create({
			model: config.llm.model,
			messages: messages as Parameters<
				typeof llm.chat.completions.create
			>[0]["messages"],
			tools: activeToolSpecs,
			temperature,
			max_tokens: 2048,
			stream: true,
		});

		const contentParts: string[] = [];
		let finishReason: string | null = null;
		const toolCallMap = new Map<
			number,
			{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}
		>();

		try {
			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta;
				if (!delta) continue;

				if (chunk.choices[0]?.finish_reason) {
					finishReason = chunk.choices[0].finish_reason;
				}

				if (delta.content) {
					contentParts.push(delta.content);
				}

				if (delta.tool_calls) {
					for (const tc of delta.tool_calls) {
						const idx = tc.index;
						const existing = toolCallMap.get(idx);
						if (!existing) {
							toolCallMap.set(idx, {
								id: tc.id ?? "",
								type: "function",
								function: {
									name: tc.function?.name ?? "",
									arguments: tc.function?.arguments ?? "",
								},
							});
						} else {
							if (tc.id) existing.id = tc.id;
							if (tc.function?.name)
								existing.function.name =
									existing.function.name || tc.function.name;
							if (tc.function?.arguments)
								existing.function.arguments += tc.function.arguments;
						}
					}
				}
			}
		} catch (error) {
			console.error("[agent] Stream error:", error);
			break;
		}

		// 空レスポンスのガード（チャンクが一つも来なかった場合）
		if (
			contentParts.length === 0 &&
			toolCallMap.size === 0 &&
			finishReason === null
		) {
			console.error("[agent] Empty streaming response (no chunks received)");
			break;
		}

		// max_tokens に到達して出力が途中で切れた場合のガード
		if (finishReason === "length") {
			console.warn("[agent] Response truncated by max_tokens, skipping");
			break;
		}

		const assembledContent =
			contentParts.length > 0 ? contentParts.join("") : null;
		const assembledToolCalls =
			toolCallMap.size > 0
				? [...toolCallMap.entries()]
						.sort(([a], [b]) => a - b)
						.map(([, tc]) => tc)
				: undefined;

		const assistantMessage = {
			content: assembledContent,
			tool_calls: assembledToolCalls,
		};

		console.log(
			`[agent] LLM response | finish_reason: ${finishReason} | content: ${assistantMessage.content?.slice(0, 100) ?? "(null)"} | tool_calls: ${JSON.stringify(assistantMessage.tool_calls ?? [])}`,
		);

		// function tool_calls のみフィルタリング（custom tool は無視）
		const rawToolCalls =
			assistantMessage.tool_calls?.filter(
				(
					tc,
				): tc is typeof tc & {
					type: "function";
					function: { name: string; arguments: string };
				} => tc.type === "function",
			) ?? [];

		// 連結 JSON 展開: 1つの tool_call に複数の JSON オブジェクトが
		// 連結されている場合、各オブジェクトのキーからツール名を推定して
		// 別々の tool_call として展開する
		const functionToolCalls: typeof rawToolCalls = [];
		for (const toolCall of rawToolCalls) {
			const allObjects = parseAllJsonObjects(toolCall.function.arguments);
			if (allObjects.length <= 1) {
				// 単一オブジェクト（または空）: そのまま
				functionToolCalls.push(toolCall);
			} else {
				console.log(
					`[agent] Expanding concatenated JSON: ${allObjects.length} objects in tool_call "${toolCall.function.name}"`,
				);
				// 1つ目: 宣言されたツール名を使用
				functionToolCalls.push({
					...toolCall,
					function: {
						...toolCall.function,
						arguments: JSON.stringify(allObjects[0]),
					},
				});
				// 2つ目以降: キーからツール名を推定
				for (let j = 1; j < allObjects.length; j++) {
					const obj = allObjects[j];
					if (!obj) continue;
					const inferredName = inferToolNameFromArgs(obj);
					if (inferredName) {
						// NOTE: 合成 ID は OpenAI の call_xxx 形式から外れるが、
						// aiclient-2-api 経由の Gemini では問題なし
						functionToolCalls.push({
							id: `${toolCall.id}_x${j}`,
							type: "function",
							function: {
								name: inferredName,
								arguments: JSON.stringify(obj),
							},
						});
						console.log(`[agent]   → expanded[${j}]: ${inferredName}`, obj);
					} else {
						console.warn(
							`[agent]   → expanded[${j}]: could not infer tool, skipping`,
							obj,
						);
					}
				}
			}
		}

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
		// voice モード時はフォールバック送信しない（voice_reply ツール経由で話すべき）
		if (functionToolCalls.length === 0) {
			const textContent = assistantMessage.content?.trim();
			if (
				textContent &&
				!messageSent &&
				!isVoiceMode &&
				ctx.channel.isSendable()
			) {
				// cron トリガー時は重複チェック
				if (ctx.triggeredBy === "cron" && isDuplicate(guildId, textContent)) {
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
						recordMessage(guildId, textContent);
						saveMessage({
							guildId,
							channelId: ctx.channel.id,
							userId: client.user?.id ?? "bot",
							username: client.user?.displayName ?? "bot",
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
				toolName === "send_message" ||
				toolName === "reply_to_message" ||
				toolName === "voice_reply";

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
					const args = parseToolArguments(toolCall.function.arguments);

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
		guildId,
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
