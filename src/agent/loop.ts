import type { Message } from "discord.js";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { config } from "../config.ts";
import { getRecentMessages, saveBotAction } from "../db/queries.ts";
import { llm } from "../llm/client.ts";
import { goalsToPrompt } from "../llm/goals.ts";
import { loadGlobalMemory, loadMemory, memoryToPrompt } from "../llm/memory.ts";
import {
	loadPersonality,
	personalityToPrompt,
} from "../llm/prompts/personality.ts";
import { SYSTEM_PROMPT } from "../llm/prompts/system.ts";
import {
	lockChannel,
	markChannelResponded,
	unlockChannel,
} from "../llm/triage-throttle.ts";
import { formatJSTFull, formatJSTShort } from "../utils/time.ts";
import {
	getToolHandler,
	inferToolNameFromArgs,
	toolSpecs,
	voiceToolSpecs,
} from "./tools/index.ts";
import type { AgentContext } from "./types.ts";

const MAX_ITERATIONS = 5;
const TEXT_ONLY_RETRY_MAX_LENGTH = 1000;

/**
 * text-only response リトライ時のプロンプトを組み立てる。
 * assistantContent は string | null（LLM の assembledContent）。
 */
export function buildTextOnlyRetryPrompt(
	assistantContent: string | null,
): string {
	const textContent =
		typeof assistantContent === "string"
			? assistantContent.trim().slice(0, TEXT_ONLY_RETRY_MAX_LENGTH)
			: "";
	if (textContent) {
		return (
			"エラー: テキスト応答は無効です。あなたが返したテキストはユーザーには届いていません。\n" +
			`あなたの応答内容:\n「${textContent}」\n\n` +
			"この内容をユーザーに届けるために、reply_to_message または send_message ツールを使って送信してください。\n" +
			"送信する必要がない場合は do_nothing ツールを使ってください。\n" +
			"テキストを直接返してもユーザーには見えません。必ずツールを使ってください。"
		);
	}
	return (
		"エラー: テキスト応答は無効です。必ずツール（関数呼び出し）を使って行動してください。\n" +
		"- メッセージを送りたい場合: send_message または reply_to_message ツールを使う\n" +
		"- 何もしない場合: do_nothing ツールを使う\n" +
		"テキストを直接返さず、ツールを呼び出してください。"
	);
}

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
					} catch (e) {
						console.warn(
							`[agent] Skipping invalid JSON fragment: ${objStr.slice(0, 100)}`,
							e,
						);
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

export const IMAGE_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);
export const MAX_IMAGES_PER_MESSAGE = 4;

/**
 * Discord Message から画像 attachment を抽出し、OpenAI の image_url パーツ配列を返す。
 * NOTE: Discord CDN URL には有効期限付き署名が含まれる場合がある。
 * 直近メッセージのみが対象のため通常問題ないが、古いメッセージの画像は失効の可能性あり。
 */
function extractImageParts(msg: Message): ChatCompletionContentPart[] {
	const parts: ChatCompletionContentPart[] = [];
	for (const attachment of msg.attachments.values()) {
		if (parts.length >= MAX_IMAGES_PER_MESSAGE) break;
		if (
			attachment.contentType &&
			IMAGE_CONTENT_TYPES.has(attachment.contentType)
		) {
			parts.push({
				type: "image_url",
				image_url: { url: attachment.url, detail: "low" },
			});
		}
	}
	return parts;
}

interface ConversationMessage {
	role: "user" | "assistant";
	content: string | ChatCompletionContentPart[];
}

function buildConversationHistory(messages: Message[]): ConversationMessage[] {
	return messages.map((msg) => {
		const time = formatJSTShort(new Date(msg.createdTimestamp));
		const text = `[${time} ${msg.author.displayName}]: ${msg.content}`;
		// assistant ロールに image_url パーツは非対応のため、bot メッセージでは画像を除外
		const imageParts = msg.author.bot ? [] : extractImageParts(msg);
		return {
			role: (msg.author.bot ? "assistant" : "user") as "user" | "assistant",
			content:
				imageParts.length > 0
					? [{ type: "text" as const, text }, ...imageParts]
					: text,
		};
	});
}

/** DB メッセージ行を "MM/DD HH:MM ユーザー名: 内容" 形式に整形する */
function formatDbMessages(
	rows: {
		createdAt?: string | Date | null;
		username: string;
		content: string;
	}[],
): string {
	return rows
		.map((m) => {
			const time = m.createdAt ? formatJSTShort(new Date(m.createdAt)) : "?";
			return `[${time} ${m.username}]: ${m.content}`;
		})
		.join("\n");
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
	// triage-react モードではリアクションのみの可能性が高いため typing を抑制
	const skipTyping = ctx.triggeredBy === "triage-react";
	const sendTypingSafe = () => {
		if ("sendTyping" in ctx.channel) {
			(ctx.channel as { sendTyping: () => Promise<void> })
				.sendTyping()
				.catch((e) => console.warn("[agent] sendTyping failed:", e));
		}
	};
	if (!skipTyping) sendTypingSafe();
	const typingInterval = skipTyping ? null : setInterval(sendTypingSafe, 5_000);

	try {
		return await _runAgentLoopBody(ctx);
	} finally {
		if (typingInterval) clearInterval(typingInterval);
	}
}

async function _runAgentLoopBody(ctx: AgentContext): Promise<void> {
	const guildId = ctx.guild.id;
	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);
	const memory = loadMemory(guildId);
	const globalMemory = loadGlobalMemory();
	const memoryPrompt = memoryToPrompt(memory, globalMemory);

	// 統合 SYSTEM_PROMPT + personality + memory
	const systemPrompt = `${SYSTEM_PROMPT}\n\n${personalityPrompt}\n${memoryPrompt}`;

	// 会話履歴を構築
	const messages: Array<{
		role: "system" | "user" | "assistant" | "tool";
		content: string | ChatCompletionContentPart[] | null;
		tool_calls?: Array<{
			id: string;
			type: "function";
			function: { name: string; arguments: string };
		}>;
		tool_call_id?: string;
		name?: string;
	}> = [{ role: "system", content: systemPrompt }];

	// チャンネル情報・現在時刻を全トリガー共通で追加
	const channelName =
		"name" in ctx.channel ? (ctx.channel.name as string) : "DM";
	const channelTopic =
		"topic" in ctx.channel ? (ctx.channel.topic as string | null) : null;
	messages.push({
		role: "system",
		content: `現在のチャンネル: #${channelName}${channelTopic ? `\nチャンネルトピック: ${channelTopic}` : ""}
現在時刻: ${formatJSTFull(new Date())}

チャンネルの話題の流れに沿った発言を心がけること。古い話題を唐突に掘り返さないこと。`,
	});

	const isVoiceMode = ctx.triggeredBy === "voice";

	if (isVoiceMode && ctx.voiceContext) {
		// ボイスチャットトリガー
		const vc = ctx.voiceContext;
		const transcriptHistory = vc.recentTranscripts
			.map((t) => {
				const time = formatJSTShort(new Date(t.timestamp));
				return `[${time} ${t.displayName}]: ${t.text}`;
			})
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
	} else if (
		ctx.triggerMessage &&
		ctx.triggeredBy === "triage-react" &&
		ctx.triageReactContext
	) {
		// triage-react トリガー: 会話を読んでリアクションするか判断する
		const recentMessages = await ctx.triggerMessage.channel.messages.fetch({
			limit: 15,
		});
		const triggerId = ctx.triggerMessage.id;
		const history = buildConversationHistory(
			[...recentMessages.values()].filter((m) => m.id !== triggerId).reverse(),
		);
		for (const msg of history) {
			messages.push(msg);
		}
		const triggerTime = formatJSTShort(
			new Date(ctx.triggerMessage.createdTimestamp),
		);
		const triggerText = `[${triggerTime} ${ctx.triggerMessage.author.displayName}]: ${ctx.triggerMessage.content}`;
		const triggerImageParts = extractImageParts(ctx.triggerMessage);
		messages.push({
			role: "user",
			content:
				triggerImageParts.length > 0
					? [{ type: "text" as const, text: triggerText }, ...triggerImageParts]
					: triggerText,
		});
		messages.push({
			role: "system",
			content: `トリアージ判定で「何か感じた」と判定されました（理由: ${ctx.triageReactContext.reasoning}）。
このメッセージに対してどう反応するか決めてください。

- 何か感じたら add_reaction で絵文字リアクションを付ける（Unicode 絵文字1つ）
- 印象的だったら save_memory で記憶に残す
- 会話の内容から気分や興味が変わったら update_personality で更新する
- 特に何も感じなければ do_nothing
- メッセージ送信（send_message / reply_to_message）は基本不要。本当に返信したい時のみ`,
		});
	} else if (ctx.triggerMessage && ctx.triggeredBy === "triage") {
		// メッセージトリガー: 直近の会話履歴 + トリガーメッセージ
		const recentMessages = await ctx.triggerMessage.channel.messages.fetch({
			limit: 30,
		});
		// トリガーメッセージは後で個別に追加するため、履歴から除外して重複を防ぐ
		const triggerId = ctx.triggerMessage.id;
		const history = buildConversationHistory(
			[...recentMessages.values()].filter((m) => m.id !== triggerId).reverse(),
		);
		for (const msg of history) {
			messages.push(msg);
		}
		const triggerTime = formatJSTShort(
			new Date(ctx.triggerMessage.createdTimestamp),
		);
		const triggerText = `[${triggerTime} ${ctx.triggerMessage.author.displayName}]: ${ctx.triggerMessage.content}`;
		const triggerImageParts = extractImageParts(ctx.triggerMessage);
		messages.push({
			role: "user",
			content:
				triggerImageParts.length > 0
					? [{ type: "text" as const, text: triggerText }, ...triggerImageParts]
					: triggerText,
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
			messages.push({
				role: "user",
				content: `## 直近の会話\n${formatDbMessages(dbMessages)}`,
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
			messages.push({
				role: "user",
				content: `## #${ctx.patrolContext.channelName} の直近の会話\n${formatDbMessages(dbMessages)}`,
			});
		}
		messages.push({
			role: "user",
			content: `あなたはこのチャンネル (#${ctx.patrolContext.channelName}) を ${ctx.patrolContext.minutesSinceLastBotMessage} 分間見ていませんでした。
会話を読んで状況を把握してください。

【最重要】ほぼ確実に do_nothing を選んでください。あなたは基本的に静かな存在です。
発言してよいのは、以下の極めて限定的なケースのみ:
- あなたの名前が直接呼ばれていて、明確に返答を求められている場合
- 誰かが本当に困っていて、あなたしか助けられない具体的な情報がある場合

以下の場合は絶対に発言しないでください:
- 「面白そうだから一言言いたい」程度の気持ち
- 話題に関連する知識があるだけ
- 会話を盛り上げたい、参加したいという気持ち
- 雑談や独り言

迷ったら do_nothing です。99% の場合は do_nothing が正解です。`,
		});
	} else if (ctx.customTaskContext) {
		// カスタムタスクトリガー
		const dbMessages = getRecentMessages(ctx.channel.id, 10);
		if (dbMessages.length > 0) {
			messages.push({
				role: "user",
				content: `## 直近の会話\n${formatDbMessages(dbMessages)}`,
			});
		}
		messages.push({
			role: "user",
			content: `定期タスク「${ctx.customTaskContext.taskDescription}」(${ctx.customTaskContext.taskId}) の実行時間です。

${ctx.customTaskContext.taskPrompt}

【重要】必要なアクションがなければ do_nothing を呼んでください。
義務感で何かを投稿する必要はありません。タスクの目的に沿った行動のみ行ってください。`,
		});
	} else if (ctx.goalContext) {
		// ゴールチェックトリガー
		const dbMessages = getRecentMessages(ctx.channel.id, 5);
		if (dbMessages.length > 0) {
			messages.push({
				role: "user",
				content: `## 直近の会話\n${formatDbMessages(dbMessages)}`,
			});
		}
		messages.push({
			role: "user",
			content: `${ctx.goalContext.activeGoalsSummary}

目標の進捗を内部的に確認してください。
やれることは update_goal_progress でメモを残す、complete_goal で完了にする、web_search で調べる程度です。

【重要】チャンネルへのメッセージ送信（send_message, reply_to_message）は基本的にしないでください。
ゴール確認は内部処理です。よほど重要な発見や報告がない限り、黙って確認だけして do_nothing で終了してください。`,
		});
	} else {
		// cron 自主発言トリガー（デフォルト）
		const dbMessages = getRecentMessages(ctx.channel.id, 10);
		if (dbMessages.length > 0) {
			messages.push({
				role: "user",
				content: `## 直近の会話\n${formatDbMessages(dbMessages)}`,
			});
		}

		const goalsPrompt = goalsToPrompt(guildId);
		messages.push({
			role: "user",
			content: `${goalsPrompt ? `${goalsPrompt}\n` : ""}
自由行動タイム。以下から選んでください:
- web_search で気になることを調べる
- 目標があれば進捗を確認・更新する
- 特に何もなければ do_nothing

【重要】独り言の投稿は極めて稀にしてください。本当に共有したい発見や、心から伝えたいことがある場合のみ。
「何か投稿しなきゃ」という義務感での投稿は不要です。95% 以上の確率で do_nothing が正解です。`,
		});
	}

	const executedTools: string[] = [];
	let messageSent = false;
	let shouldStop = false;
	let textOnlyRetries = 0;

	// voice / triage-react モード: イテレーション数とパラメータを調整
	const isReactMode = ctx.triggeredBy === "triage-react";
	const maxIter = isVoiceMode || isReactMode ? 3 : MAX_ITERATIONS;
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
		// 別々の tool_call として展開する（最大 MAX_EXPANDED_OBJECTS 個）
		const MAX_EXPANDED_OBJECTS = 5;
		const functionToolCalls: typeof rawToolCalls = [];
		for (const toolCall of rawToolCalls) {
			const allObjects = parseAllJsonObjects(toolCall.function.arguments).slice(
				0,
				MAX_EXPANDED_OBJECTS,
			);
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
					const inferred = inferToolNameFromArgs(obj);
					if (inferred) {
						// NOTE: 合成 ID は OpenAI の call_xxx 形式から外れるが、
						// aiclient-2-api 経由の Gemini では問題なし
						functionToolCalls.push({
							id: `${toolCall.id}_x${j}`,
							type: "function",
							function: {
								name: inferred.name,
								arguments: JSON.stringify(obj),
							},
						});
						console.log(
							`[agent]   → expanded[${j}]: ${inferred.name} (score=${inferred.score.toFixed(2)})`,
							obj,
						);
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

		// ツール呼び出しがなければ、リトライを要求
		// LLM は必ずツール経由で行動する必要がある
		if (functionToolCalls.length === 0) {
			textOnlyRetries++;
			if (textOnlyRetries > 1) {
				// 2回連続テキスト応答は打ち切り
				console.warn(
					`[agent] Giving up after ${textOnlyRetries} consecutive text-only responses`,
				);
				break;
			}
			console.warn(
				`[agent] Text-only response detected (attempt ${textOnlyRetries}), requesting tool use retry`,
			);
			messages.push({
				role: "user",
				content: buildTextOnlyRetryPrompt(
					assistantMessage.content as string | null,
				),
			});
			continue;
		}

		// ツール使用成功: テキストリトライカウンターをリセット
		textOnlyRetries = 0;

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
