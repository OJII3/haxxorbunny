import { addUserNote, appendMemoryEntry } from "../../llm/memory.ts";
import {
	type Personality,
	updatePersonality,
} from "../../llm/prompts/personality.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const saveMemoryHandler: ToolHandler = async (args) => {
	const entry = args.entry as string;
	if (!entry) return fail("entry is required");
	if (entry.length > 30) return fail("entry must be 30 characters or less");
	await appendMemoryEntry(entry);
	return ok(`Memory saved: ${entry}`);
};

const saveUserNoteHandler: ToolHandler = async (args) => {
	const username = args.username as string;
	const note = args.note as string;
	if (!username || !note) return fail("username and note are required");
	await addUserNote(username, note);
	return ok(`User note saved for ${username}: ${note}`);
};

const updatePersonalityHandler: ToolHandler = async (args) => {
	const partial: Partial<
		Pick<Personality, "mood" | "recent_topics" | "interests">
	> = {};
	if (args.mood !== undefined) partial.mood = args.mood as string;
	if (args.recent_topics !== undefined)
		partial.recent_topics = args.recent_topics as string[];
	if (args.interests !== undefined)
		partial.interests = args.interests as string[];

	if (Object.keys(partial).length === 0)
		return fail(
			"At least one field (mood, recent_topics, interests) is required",
		);

	updatePersonality(partial);
	console.log("[agent/personality] Updated:", partial);
	return ok(`Personality updated: ${JSON.stringify(partial)}`);
};

export const memoryTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "save_memory",
				description:
					"長期記憶にエントリを保存する。重要なことだけ記憶する（30字以内）",
				parameters: {
					type: "object",
					properties: {
						entry: {
							type: "string",
							description: "覚えておきたいこと（30字以内）",
						},
					},
					required: ["entry"],
				},
			},
		},
		handler: saveMemoryHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "save_user_note",
				description: "特定ユーザーについてのメモを保存する",
				parameters: {
					type: "object",
					properties: {
						username: {
							type: "string",
							description: "ユーザーの表示名",
						},
						note: {
							type: "string",
							description: "メモ内容",
						},
					},
					required: ["username", "note"],
				},
			},
		},
		handler: saveUserNoteHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "update_personality",
				description:
					"自分の性格設定を微調整する（mood, recent_topics, interests のみ変更可）",
				parameters: {
					type: "object",
					properties: {
						mood: {
							type: "string",
							description: '現在の気分（例: "neutral", "happy", "curious"）',
						},
						recent_topics: {
							type: "array",
							items: { type: "string" },
							description: "最近の話題リスト",
						},
						interests: {
							type: "array",
							items: { type: "string" },
							description: "興味のあるトピックリスト",
						},
					},
				},
			},
		},
		handler: updatePersonalityHandler,
	},
];
