import type { Guild, Message, TextBasedChannel } from "discord.js";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";

/** チャンネル巡回コンテキスト */
export interface PatrolContext {
	/** 巡回対象チャンネル名 */
	channelName: string;
	/** bot の最終発言からの経過分 */
	minutesSinceLastBotMessage: number;
}

/** リアクションコンテキスト */
export interface ReactionContext {
	/** リアクションしたユーザー名 */
	userName: string;
	/** リアクション絵文字 */
	emoji: string;
	/** リアクション対象メッセージの内容 */
	messageContent: string;
}

/** ゴールチェックコンテキスト */
export interface GoalContext {
	/** アクティブなゴールの要約 */
	activeGoalsSummary: string;
}

/** ボイスチャットコンテキスト */
export interface VoiceContext {
	/** ボイスチャンネル名 */
	voiceChannelName: string;
	/** 参加中の人間メンバー名 */
	participants: string[];
	/** 直近のトランスクリプト */
	recentTranscripts: { displayName: string; text: string }[];
}

/** エージェントループに渡すコンテキスト */
export interface AgentContext {
	/** トリガーとなったメッセージ（cron 経由の場合は undefined） */
	triggerMessage?: Message;
	/** 対象チャンネル */
	channel: TextBasedChannel;
	/** 対象 Guild */
	guild: Guild;
	/** 起動トリガーの種別 */
	triggeredBy: "triage" | "cron" | "reaction" | "voice";
	/** メンション（@haxxorbunny 等）による起動かどうか */
	isMentioned?: boolean;
	/** チャンネル巡回コンテキスト */
	patrolContext?: PatrolContext;
	/** リアクションコンテキスト */
	reactionContext?: ReactionContext;
	/** ゴールチェックコンテキスト */
	goalContext?: GoalContext;
	/** ボイスチャットコンテキスト */
	voiceContext?: VoiceContext;
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
