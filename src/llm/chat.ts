import type { Message } from "discord.js";
import { config } from "../config.ts";
import { llm } from "./client.ts";
import {
	loadPersonality,
	type Personality,
	personalityToPrompt,
	updatePersonality,
} from "./prompts/personality.ts";
import { SYSTEM_PROMPT } from "./prompts/system.ts";

export interface LLMResponse {
	action: "message" | "reply" | "reaction" | "none";
	content?: string;
	emoji?: string;
	personality_update?: Partial<Personality> | null;
	reasoning?: string;
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

export async function chat(
	triggerMessage: Message,
	recentMessages: Message[],
): Promise<LLMResponse> {
	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);

	const systemPrompt = `${SYSTEM_PROMPT}\n\n${personalityPrompt}`;

	const history = buildConversationHistory(recentMessages);

	const response = await llm.chat.completions.create({
		model: config.llm.model,
		messages: [
			{ role: "system", content: systemPrompt },
			...history,
			{
				role: "user",
				content: `[${triggerMessage.author.displayName}]: ${triggerMessage.content}`,
			},
		],
		temperature: 0.8,
	});

	const raw = response.choices[0]?.message?.content;
	if (!raw) {
		return { action: "none", reasoning: "Empty response from LLM" };
	}

	try {
		const parsed = JSON.parse(raw) as LLMResponse;

		if (parsed.personality_update) {
			updatePersonality(parsed.personality_update);
			console.log("[personality] Updated:", parsed.personality_update);
		}

		return parsed;
	} catch {
		console.error("[llm] Failed to parse JSON response:", raw);
		return {
			action: "message",
			content: raw,
			reasoning: "Failed to parse JSON, returning raw text",
		};
	}
}
