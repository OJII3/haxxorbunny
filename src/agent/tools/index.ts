import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import type { ToolDefinition, ToolHandler } from "../types.ts";
import { discordTools } from "./discord.ts";
import { memoryTools } from "./memory.ts";

const allTools: ToolDefinition[] = [...discordTools, ...memoryTools];

/** OpenAI API に渡す tools 定義配列 */
export const toolSpecs: ChatCompletionFunctionTool[] = allTools.map(
	(t) => t.spec,
);

/** ツール名 → ハンドラの Map */
const handlerMap = new Map<string, ToolHandler>(
	allTools.map((t) => [t.spec.function.name, t.handler]),
);

export function getToolHandler(name: string): ToolHandler | undefined {
	return handlerMap.get(name);
}
