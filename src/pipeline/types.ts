import type { Guild, Message, TextBasedChannel } from "discord.js";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import type { VoiceContext } from "../agent/types.ts";
import type { CategoryBehavior } from "../llm/channel-category.ts";
import type { GlobalMemory, Memory } from "../llm/memory.ts";
import type { MoodState, Personality } from "../llm/prompts/personality.ts";

// ── ThoughtBuffer ──

export type ThoughtType =
	| "curiosity"
	| "emotion"
	| "observation"
	| "idea"
	| "goal_related";

export interface ThoughtFragment {
	id: string;
	content: string;
	type: ThoughtType;
	source: string;
	timestamp: string;
	intensity: number;
	relatedGoalId?: string;
}

// ── Phase 0: Perception ──

export interface ConversationEntry {
	role: "user" | "assistant";
	content: string | ChatCompletionContentPart[];
}

export interface PerceptionResult {
	author: string;
	channel: {
		id: string;
		name: string;
		topic: string | null;
	};
	content: string;
	hasImages: boolean;
	isMentioned: boolean;
	isBotMessage: boolean;
	conversationHistory: ConversationEntry[];
	triggerMessage?: Message;
	guild: Guild;
	guildId: string;
}

// ── Phase 1: Triage (Extended) ──

export interface ExtendedTriageResult {
	action: "ignore" | "react" | "engage";
	intent: string;
	emotional_note: string;
	confidence: number;
	reasoning: string;
}

// ── Phase 2: Planning ──

export type PlanAction =
	| "reply"
	| "react"
	| "memorize"
	| "search_then_reply"
	| "do_nothing";

export interface PlanResult {
	actions: PlanAction[];
	reply_approach: string | null;
	reply_as_normal: boolean;
	react_emoji: string | null;
	should_memorize: boolean;
	memo: string | null;
	memo_impact: number;
	should_search: boolean;
	search_query: string | null;
}

// ── Phase 3: Generation ──

export interface GenerationResult {
	text: string;
}

// ── Phase 4: Execution ──

export interface ExecutionLog {
	actions: {
		type: string;
		success: boolean;
		detail: string;
	}[];
	timestamp: string;
}

// ── Pipeline Context ──

export interface PipelineContext {
	guild: Guild;
	guildId: string;
	channel: TextBasedChannel;
	channelId: string;
	triggerMessage?: Message;
	isMentioned: boolean;
	personality: Personality;
	mood: MoodState;
	memory: Memory;
	globalMemory: GlobalMemory;
	channelBehavior?: CategoryBehavior;
	voiceContext?: VoiceContext;
}
