import { config } from "../../config.ts";
import {
	type CategoryBehavior,
	type ChannelCategory,
	getPresetBehavior,
	loadCategories,
	saveCategories,
} from "../../llm/channel-category.ts";
import { triageLlm } from "../../llm/triage-client.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const MAX_CUSTOM_CATEGORIES = 5;

const BEHAVIOR_PARSING_SYSTEM_PROMPT = `あなたはチャンネルカテゴリの振る舞いパーシングエンジンです。
ユーザーが自然言語で記述したチャンネルの振る舞いを、構造化パラメータに変換してください。

## パラメータ

### avg_offset (number, -1.0 ~ +1.0)
bot の sociability+curiosity 平均値に加算するオフセット。
- -1.0: 極めて消極的（メンション以外ほぼ無視）
- -0.5: かなり控えめ（重要な時だけ反応）
- 0.0: 通常
- +0.3: やや積極的（話題に興味があれば参加）
- +0.5: かなり積極的（面白そうな話題には参加）
- +1.0: 極めて積極的（ほぼ全ての会話に参加）

### allow_react (boolean)
- true: リアクション（絵文字）を付けてよい
- false: リアクションも付けない

### allow_unsolicited (boolean)
- true: 自発的な発言（cron/独り言）を許可
- false: 自発的な発言はしない

### respond_to_bots (boolean)
- true: 他のbotのメッセージにも反応する
- false: botのメッセージには反応しない

### custom_instructions (string, 50字以内)
トリアージ時の追加指示。チャンネルの特性に応じた判断基準を簡潔に記述。
空文字列でもよい。

## 応答フォーマット
JSON のみを返すこと。それ以外のテキストは一切不要。
{"avg_offset": 0.0, "allow_react": true, "allow_unsolicited": false, "respond_to_bots": false, "custom_instructions": ""}`;

async function parseBehaviorDescription(
	description: string,
): Promise<CategoryBehavior> {
	const response = await triageLlm.chat.completions.create({
		model: config.triage.model,
		messages: [
			{ role: "system", content: BEHAVIOR_PARSING_SYSTEM_PROMPT },
			{ role: "user", content: description },
		],
		temperature: 0.1,
		max_tokens: 256,
	});

	const raw = response.choices[0]?.message?.content?.trim();
	if (!raw) {
		throw new Error("Empty response from parsing LLM");
	}

	const cleaned = raw
		.replace(/^```(?:json)?\s*\n?/i, "")
		.replace(/\n?```\s*$/i, "");
	const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error(`No valid JSON in parsing response: ${raw}`);
	}

	const parsed = JSON.parse(jsonMatch[0]) as CategoryBehavior;

	// バリデーション
	parsed.avg_offset = Math.max(-1, Math.min(1, Number(parsed.avg_offset) || 0));
	parsed.allow_react = Boolean(parsed.allow_react);
	parsed.allow_unsolicited = Boolean(parsed.allow_unsolicited);
	parsed.respond_to_bots = Boolean(parsed.respond_to_bots);
	parsed.custom_instructions = String(parsed.custom_instructions || "").slice(
		0,
		50,
	);

	return parsed;
}

function formatCategoryInfo(
	c: ChannelCategory,
	guild: {
		channels: { cache: { get: (id: string) => { name: string } | undefined } };
	},
): string {
	const channelNames = c.channel_ids.map((id) => {
		const ch = guild.channels.cache.get(id);
		return ch ? `#${ch.name} (${id})` : `(不明: ${id})`;
	});
	return [
		`[${c.id}] ${c.name}${c.builtin ? " (プリセット)" : ""}`,
		`  説明: ${c.description}`,
		`  振る舞い: avg_offset=${c.behavior.avg_offset}, allow_react=${c.behavior.allow_react}, allow_unsolicited=${c.behavior.allow_unsolicited}, respond_to_bots=${c.behavior.respond_to_bots}`,
		c.behavior.custom_instructions
			? `  指示: ${c.behavior.custom_instructions}`
			: null,
		channelNames.length > 0
			? `  チャンネル (${channelNames.length}): ${channelNames.join(", ")}`
			: "  チャンネル: なし",
	]
		.filter(Boolean)
		.join("\n");
}

// --- ハンドラ ---

const listCategoriesHandler: ToolHandler = async (_args, ctx) => {
	const guildId = ctx.guild.id;
	const data = loadCategories(guildId);

	if (data.categories.length === 0) {
		return ok("カテゴリが設定されていません");
	}

	const lines = data.categories.map((c) => formatCategoryInfo(c, ctx.guild));
	return ok(
		`チャンネルカテゴリ一覧 (${data.categories.length}件):\n\n${lines.join("\n\n")}\n\nlast_updated: ${data.last_updated || "never"}\n\n未分類チャンネルではメンション時のみ反応します。`,
	);
};

const createCategoryHandler: ToolHandler = async (args, ctx) => {
	const id = args.id as string | undefined;
	const name = args.name as string | undefined;
	const description = args.description as string | undefined;
	const behaviorDescription = args.behavior_description as string | undefined;

	if (!id) return fail("id is required");
	if (!name) return fail("name is required");
	if (!description) return fail("description is required");
	if (!behaviorDescription) return fail("behavior_description is required");

	// ID バリデーション
	if (!/^[a-z0-9-]+$/.test(id)) {
		return fail("id は英小文字・数字・ハイフンのみ使用可能です");
	}

	const guildId = ctx.guild.id;
	const data = loadCategories(guildId);

	// 重複チェック
	if (data.categories.find((c) => c.id === id)) {
		return fail(`カテゴリ ID "${id}" は既に存在します`);
	}

	// カスタムカテゴリ上限
	const customCount = data.categories.filter((c) => !c.builtin).length;
	if (customCount >= MAX_CUSTOM_CATEGORIES) {
		return fail(
			`カスタムカテゴリは最大${MAX_CUSTOM_CATEGORIES}個までです（現在${customCount}個）`,
		);
	}

	let behavior: CategoryBehavior;
	try {
		behavior = await parseBehaviorDescription(behaviorDescription);
	} catch (error) {
		console.error("[channel-category] Behavior parsing failed:", error);
		return fail(`振る舞いのパースに失敗しました: ${error}`);
	}

	const category: ChannelCategory = {
		id,
		name,
		description,
		builtin: false,
		behavior,
		channel_ids: [],
	};

	data.categories.push(category);
	saveCategories(guildId, data);

	return ok(
		`カテゴリ "${name}" (${id}) を作成しました:\n` +
			`- avg_offset: ${behavior.avg_offset}\n` +
			`- allow_react: ${behavior.allow_react}\n` +
			`- allow_unsolicited: ${behavior.allow_unsolicited}\n` +
			`- respond_to_bots: ${behavior.respond_to_bots}\n` +
			`- custom_instructions: ${behavior.custom_instructions || "(なし)"}`,
	);
};

const updateCategoryHandler: ToolHandler = async (args, ctx) => {
	const categoryId = args.category_id as string | undefined;
	if (!categoryId) return fail("category_id is required");

	const guildId = ctx.guild.id;
	const data = loadCategories(guildId);
	const category = data.categories.find((c) => c.id === categoryId);
	if (!category) return fail(`カテゴリ "${categoryId}" が見つかりません`);

	const newName = args.name as string | undefined;
	const newDescription = args.description as string | undefined;
	const behaviorDescription = args.behavior_description as string | undefined;

	if (category.builtin && (newName || newDescription)) {
		return fail(
			"ビルトインカテゴリの名前・説明は変更できません（振る舞いのみ変更可）",
		);
	}

	if (newName) category.name = newName;
	if (newDescription) category.description = newDescription;

	if (behaviorDescription) {
		try {
			const newBehavior = await parseBehaviorDescription(behaviorDescription);
			category.behavior = newBehavior;
		} catch (error) {
			console.error("[channel-category] Behavior parsing failed:", error);
			return fail(`振る舞いのパースに失敗しました: ${error}`);
		}
	}

	saveCategories(guildId, data);
	return ok(`カテゴリ "${category.name}" (${categoryId}) を更新しました`);
};

const deleteCategoryHandler: ToolHandler = async (args, ctx) => {
	const categoryId = args.category_id as string | undefined;
	if (!categoryId) return fail("category_id is required");

	const guildId = ctx.guild.id;
	const data = loadCategories(guildId);

	const idx = data.categories.findIndex((c) => c.id === categoryId);
	if (idx === -1) return fail(`カテゴリ "${categoryId}" が見つかりません`);

	const category = data.categories[idx];
	if (!category) return fail(`カテゴリ "${categoryId}" が見つかりません`);
	if (category.builtin) {
		return fail("ビルトインカテゴリは削除できません");
	}

	const removedChannels = category.channel_ids.length;
	data.categories.splice(idx, 1);
	saveCategories(guildId, data);

	return ok(
		`カテゴリ "${category.name}" (${categoryId}) を削除しました。${removedChannels > 0 ? `${removedChannels}チャンネルが未分類に戻りました` : ""}`,
	);
};

const assignChannelHandler: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	const categoryId = args.category_id as string | undefined;

	if (!channelId) return fail("channel_id is required");
	if (!categoryId) return fail("category_id is required");

	const guildId = ctx.guild.id;

	// チャンネル存在チェック
	const ch = ctx.guild.channels.cache.get(channelId);
	if (!ch) return fail(`チャンネル ${channelId} が見つかりません`);

	const data = loadCategories(guildId);
	const targetCategory = data.categories.find((c) => c.id === categoryId);
	if (!targetCategory) return fail(`カテゴリ "${categoryId}" が見つかりません`);

	// 他のカテゴリから削除
	let movedFrom: string | null = null;
	for (const cat of data.categories) {
		const idx = cat.channel_ids.indexOf(channelId);
		if (idx !== -1) {
			movedFrom = cat.id;
			cat.channel_ids.splice(idx, 1);
		}
	}

	// ビルトインカテゴリの場合、プリセットの振る舞いを再適用
	if (targetCategory.builtin) {
		const presetBehavior = getPresetBehavior(targetCategory.id);
		if (presetBehavior) {
			targetCategory.behavior = { ...presetBehavior };
		}
	}

	targetCategory.channel_ids.push(channelId);
	saveCategories(guildId, data);

	const moveInfo = movedFrom ? ` (${movedFrom} から移動)` : "";

	return ok(
		`#${ch.name} を "${targetCategory.name}" (${categoryId}) に割り当てました${moveInfo}`,
	);
};

const unassignChannelHandler: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	if (!channelId) return fail("channel_id is required");

	const guildId = ctx.guild.id;
	const data = loadCategories(guildId);

	let found = false;
	let categoryName = "";
	for (const cat of data.categories) {
		const idx = cat.channel_ids.indexOf(channelId);
		if (idx !== -1) {
			categoryName = cat.name;
			cat.channel_ids.splice(idx, 1);
			found = true;
			break;
		}
	}

	if (!found) {
		return fail(`チャンネル ${channelId} はどのカテゴリにも属していません`);
	}

	saveCategories(guildId, data);

	const ch = ctx.guild.channels.cache.get(channelId);
	const name = ch ? `#${ch.name}` : channelId;

	return ok(
		`${name} を "${categoryName}" から外しました（未分類に戻りました）`,
	);
};

export const channelCategoryTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "list_categories",
				description: "チャンネルカテゴリの一覧と所属チャンネルを表示する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: listCategoriesHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "create_category",
				description:
					"カスタムチャンネルカテゴリを作成する。振る舞いは自然言語で指定（LLMが構造化パラメータに変換）",
				parameters: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "カテゴリID（英小文字・数字・ハイフン）",
						},
						name: {
							type: "string",
							description: "カテゴリの表示名",
						},
						description: {
							type: "string",
							description: "カテゴリの説明",
						},
						behavior_description: {
							type: "string",
							description:
								"振る舞いの自然言語記述（例: 「積極的に参加するが、bot同士の会話も許可」）",
						},
					},
					required: ["id", "name", "description", "behavior_description"],
				},
			},
		},
		handler: createCategoryHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "update_category",
				description:
					"カテゴリの名前・説明・振る舞いを更新する。ビルトインカテゴリは振る舞いのみ変更可",
				parameters: {
					type: "object",
					properties: {
						category_id: {
							type: "string",
							description: "対象カテゴリのID",
						},
						name: {
							type: "string",
							description: "新しい表示名（省略可）",
						},
						description: {
							type: "string",
							description: "新しい説明（省略可）",
						},
						behavior_description: {
							type: "string",
							description: "新しい振る舞いの自然言語記述（省略可）",
						},
					},
					required: ["category_id"],
				},
			},
		},
		handler: updateCategoryHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "delete_category",
				description:
					"カスタムカテゴリを削除する（ビルトインは不可）。所属チャンネルは未分類に戻る",
				parameters: {
					type: "object",
					properties: {
						category_id: {
							type: "string",
							description: "削除するカテゴリのID",
						},
					},
					required: ["category_id"],
				},
			},
		},
		handler: deleteCategoryHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "assign_channel",
				description:
					"チャンネルをカテゴリに割り当てる。既に他カテゴリにあれば移動",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "対象チャンネルのID",
						},
						category_id: {
							type: "string",
							description:
								"割り当て先カテゴリのID（my-space, observe-only, bot-chat, またはカスタムID）",
						},
					},
					required: ["channel_id", "category_id"],
				},
			},
		},
		handler: assignChannelHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "unassign_channel",
				description: "チャンネルをカテゴリから外す（未分類に戻す）",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "対象チャンネルのID",
						},
					},
					required: ["channel_id"],
				},
			},
		},
		handler: unassignChannelHandler,
	},
];
