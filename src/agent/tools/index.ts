import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import type { ToolDefinition, ToolHandler } from "../types.ts";
import { avatarTools } from "./avatar.ts";
import { discordTools } from "./discord.ts";
import { goalTools } from "./goals.ts";
import { heartbeatTools } from "./heartbeat.ts";
import { logTools } from "./logs.ts";
import { memoryTools } from "./memory.ts";
import { thinkingTools } from "./thinking.ts";
import { voiceTools } from "./voice.ts";
import { webTools } from "./web.ts";

const allTools: ToolDefinition[] = [
	...discordTools,
	...memoryTools,
	...goalTools,
	...webTools,
	...voiceTools,
	...heartbeatTools,
	...avatarTools,
	...logTools,
	...thinkingTools,
];

/** 通常モード（テキスト）で使用する tools 定義（voice ツールを除外） */
const VOICE_TOOL_NAMES = new Set(voiceTools.map((t) => t.spec.function.name));

export const toolSpecs: ChatCompletionFunctionTool[] = allTools
	.filter((t) => !VOICE_TOOL_NAMES.has(t.spec.function.name))
	.map((t) => t.spec);

/** voice モードで使用可能なツール名 */
const VOICE_ALLOWED_TOOLS = new Set([
	"voice_reply",
	"leave_voice",
	"do_nothing",
	"save_memory",
	"save_user_note",
	"update_personality",
	"recall_identity",
]);

/** voice モード用のフィルタ済みツール定義 */
export const voiceToolSpecs: ChatCompletionFunctionTool[] = allTools
	.filter((t) => VOICE_ALLOWED_TOOLS.has(t.spec.function.name))
	.map((t) => t.spec);

/** ツール名 → ハンドラの Map（全ツール対応） */
const handlerMap = new Map<string, ToolHandler>(
	allTools.map((t) => [t.spec.function.name, t.handler]),
);

export function getToolHandler(name: string): ToolHandler | undefined {
	return handlerMap.get(name);
}

/** ツール名推定の結果 */
export interface InferredTool {
	name: string;
	score: number;
}

/**
 * 引数のキーセットからツール名を推定する。
 * 連結 JSON 展開時に、2番目以降のオブジェクトがどのツールに属するかを判定する。
 * スコア (マッチ率) が 0.5 未満の場合は推定を諦めて null を返す。
 *
 * 優先順位: スコア > required 充足数 > パラメータ数が少ない（より特化した）ツール
 */
export function inferToolNameFromArgs(
	args: Record<string, unknown>,
): InferredTool | null {
	const argKeys = Object.keys(args);
	if (argKeys.length === 0) return null;

	let bestMatch: string | null = null;
	let bestScore = 0;
	let bestRequiredMatch = 0;
	let bestParamCount = Number.POSITIVE_INFINITY;

	for (const tool of allTools) {
		const name = tool.spec.function.name;
		const params = tool.spec.function.parameters as
			| {
					type: "object";
					properties?: Record<string, unknown>;
					required?: string[];
			  }
			| undefined;
		if (!params?.properties) continue;

		const toolParamKeys = new Set(Object.keys(params.properties));
		const requiredKeys = params.required ?? [];

		// 引数キーのうちツールパラメータに含まれるものの数
		let matchCount = 0;
		for (const key of argKeys) {
			if (toolParamKeys.has(key)) matchCount++;
		}
		if (matchCount === 0) continue;

		// スコア: マッチ率 (全キーが一致 = 1.0)
		const score = matchCount / argKeys.length;

		// required パラメータの充足数
		let requiredMatch = 0;
		for (const rk of requiredKeys) {
			if (rk in args) requiredMatch++;
		}

		const paramCount = toolParamKeys.size;

		// より高いスコア → required 充足度 → パラメータ数が少ない（特化）ツールを優先
		if (
			score > bestScore ||
			(score === bestScore && requiredMatch > bestRequiredMatch) ||
			(score === bestScore &&
				requiredMatch === bestRequiredMatch &&
				paramCount < bestParamCount)
		) {
			bestScore = score;
			bestMatch = name;
			bestRequiredMatch = requiredMatch;
			bestParamCount = paramCount;
		}
	}

	// 半数以上のキーがマッチしない場合は推定を諦める
	if (bestScore < 0.5 || !bestMatch) return null;
	return { name: bestMatch, score: bestScore };
}
