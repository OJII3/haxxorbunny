import type { Guild, Message, TextBasedChannel } from "discord.js";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";

/** エージェントループに渡すコンテキスト */
export interface AgentContext {
	/** トリガーとなったメッセージ（cron 経由の場合は undefined） */
	triggerMessage?: Message;
	/** 対象チャンネル */
	channel: TextBasedChannel;
	/** 対象 Guild */
	guild: Guild;
	/** 起動トリガーの種別 */
	triggeredBy: "triage" | "cron";
}

/** ツール実行結果 */
export interface ToolResult {
	success: boolean;
	result: string;
}

/** ツールハンドラ関数 */
export type ToolHandler = (
	args: Record<string, unknown>,
	ctx: AgentContext,
) => Promise<ToolResult>;

/** ツール定義 + ハンドラのセット */
export interface ToolDefinition {
	spec: ChatCompletionFunctionTool;
	handler: ToolHandler;
}
