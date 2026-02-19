import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import type { ToolDefinition, ToolHandler } from "../types.ts";
import { discordTools } from "./discord.ts";
import { goalTools } from "./goals.ts";
import { memoryTools } from "./memory.ts";
import { voiceTools } from "./voice.ts";
import { webTools } from "./web.ts";

const allTools: ToolDefinition[] = [
	...discordTools,
	...memoryTools,
	...goalTools,
	...webTools,
	...voiceTools,
];

/** OpenAI API に渡す tools 定義配列 */
export const toolSpecs: ChatCompletionFunctionTool[] = allTools.map(
	(t) => t.spec,
);

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

/** ツール名 → ハンドラの Map */
const handlerMap = new Map<string, ToolHandler>(
	allTools.map((t) => [t.spec.function.name, t.handler]),
);

export function getToolHandler(name: string): ToolHandler | undefined {
	return handlerMap.get(name);
}
