import { addUserNote, appendMemoryEntry } from "../../llm/memory.ts";
import {
	type MoodState,
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

	// mood: 4次元パラメータ (energy, positivity, sociability, curiosity)
	if (args.mood !== undefined) {
		const moodArg = args.mood as Record<string, number>;
		const mood: MoodState = {
			energy: moodArg.energy ?? 0.5,
			positivity: moodArg.positivity ?? 0.5,
			sociability: moodArg.sociability ?? 0.5,
			curiosity: moodArg.curiosity ?? 0.5,
		};
		partial.mood = mood;
	}

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
							type: "object",
							description:
								"現在の気分ベクトル。各値は 0.0〜1.0。変更したい軸だけ指定可能",
							properties: {
								energy: {
									type: "number",
									description: "元気度 (0=眠い, 1=元気いっぱい)",
								},
								positivity: {
									type: "number",
									description: "ポジティブさ (0=イライラ, 1=ご機嫌)",
								},
								sociability: {
									type: "number",
									description: "社交性 (0=一人でいたい, 1=話したい)",
								},
								curiosity: {
									type: "number",
									description: "好奇心 (0=興味なし, 1=探究心旺盛)",
								},
							},
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
