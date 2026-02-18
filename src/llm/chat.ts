import type { Message } from "discord.js";
import { config } from "../config.ts";
import { llm } from "./client.ts";
import {
	addUserNote,
	appendMemoryEntry,
	loadMemory,
	memoryToPrompt,
} from "./memory.ts";
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
	memory_entry?: string | null;
	user_note?: string | null;
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

function processMemoryFields(parsed: LLMResponse): void {
	if (parsed.memory_entry) {
		appendMemoryEntry(parsed.memory_entry);
	}
	if (parsed.user_note) {
		const colonIndex = parsed.user_note.indexOf(":");
		if (colonIndex > 0) {
			const username = parsed.user_note.slice(0, colonIndex).trim();
			const note = parsed.user_note.slice(colonIndex + 1).trim();
			if (username && note) {
				addUserNote(username, note);
			}
		}
	}
}

export async function chat(
	triggerMessage: Message,
	recentMessages: Message[],
): Promise<LLMResponse> {
	const personality = loadPersonality();
	const personalityPrompt = personalityToPrompt(personality);
	const memory = loadMemory();
	const memoryPrompt = memoryToPrompt(memory);

	const systemPrompt = `${SYSTEM_PROMPT}\n\n${personalityPrompt}\n${memoryPrompt}`;

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
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const parsed = JSON.parse(cleaned) as LLMResponse;

		if (parsed.personality_update) {
			updatePersonality(parsed.personality_update);
			console.log("[personality] Updated:", parsed.personality_update);
		}

		processMemoryFields(parsed);

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
