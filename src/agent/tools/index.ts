import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import type { ToolDefinition, ToolHandler } from "../types.ts";
import { avatarTools } from "./avatar.ts";
import { discordTools } from "./discord.ts";
import { goalTools } from "./goals.ts";
import { heartbeatTools } from "./heartbeat.ts";
import { memoryTools } from "./memory.ts";
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
