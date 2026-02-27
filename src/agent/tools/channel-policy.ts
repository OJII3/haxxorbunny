import { config } from "../../config.ts";
import {
	type ChannelPolicy,
	getChannelPolicy,
	loadChannelPolicies,
	saveChannelPolicies,
} from "../../llm/channel-policy.ts";
import { triageLlm } from "../../llm/triage-client.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const PARSING_SYSTEM_PROMPT = `あなたはチャンネルポリシーのパーシングエンジンです。
ユーザーが自然言語で記述したチャンネルの反応方針を、構造化パラメータに変換してください。

## パラメータ

### avg_offset (number, -1.0 ~ +1.0)
bot の sociability+curiosity 平均値に加算するオフセット。
- -1.0: 極めて消極的（メンション以外ほぼ無視）
- -0.5: かなり控えめ（重要な時だけ反応）
- -0.3: やや控えめ（通常の非ホームチャンネル相当）
- 0.0: 通常（ホームチャンネル相当）
- +0.3: やや積極的（話題に興味があれば参加）
- +0.5: かなり積極的（面白そうな話題には参加）
- +1.0: 極めて積極的（ほぼ全ての会話に参加）

### allow_react (boolean)
- true: リアクション（絵文字）を付けてよい
- false: リアクションも付けない（「静かにして」「見るだけ」等の指示）

### custom_instructions (string, 50字以内)
トリアージ時の追加指示。チャンネルの特性に応じた判断基準を簡潔に記述。
空文字列でもよい。

## 応答フォーマット
JSON のみを返すこと。それ以外のテキストは一切不要。
{"avg_offset": 0.0, "allow_react": true, "custom_instructions": ""}`;

interface ParsedPolicy {
	avg_offset: number;
	allow_react: boolean;
	custom_instructions: string;
}

async function parseDescription(description: string): Promise<ParsedPolicy> {
	const response = await triageLlm.chat.completions.create({
		model: config.triage.model,
		messages: [
			{ role: "system", content: PARSING_SYSTEM_PROMPT },
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

	const parsed = JSON.parse(jsonMatch[0]) as ParsedPolicy;

	// バリデーション
	parsed.avg_offset = Math.max(-1, Math.min(1, Number(parsed.avg_offset) || 0));
	parsed.allow_react = Boolean(parsed.allow_react);
	parsed.custom_instructions = String(parsed.custom_instructions || "").slice(
		0,
		50,
	);

	return parsed;
}

const setChannelPolicyHandler: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	const description = args.description as string | undefined;
	if (!channelId) return fail("channel_id is required");
	if (!description) return fail("description is required");

	const guildId = ctx.guild.id;

	// チャンネル存在チェック
	const ch = ctx.guild.channels.cache.get(channelId);
	if (!ch) return fail(`チャンネル ${channelId} が見つかりません`);

	let parsed: ParsedPolicy;
	try {
		parsed = await parseDescription(description);
	} catch (error) {
		console.error("[channel-policy] Parsing failed:", error);
		return fail(`ポリシーのパースに失敗しました: ${error}`);
	}

	const data = loadChannelPolicies(guildId);
	const existingIdx = data.policies.findIndex(
		(p) => p.channel_id === channelId,
	);

	const policy: ChannelPolicy = {
		channel_id: channelId,
		original_description: description,
		avg_offset: parsed.avg_offset,
		allow_react: parsed.allow_react,
		custom_instructions: parsed.custom_instructions,
		last_updated: new Date().toISOString(),
	};

	if (existingIdx >= 0) {
		data.policies[existingIdx] = policy;
	} else {
		data.policies.push(policy);
	}

	saveChannelPolicies(guildId, data);

	return ok(
		`#${ch.name} のポリシーを設定しました:\n` +
			`- 説明: ${description}\n` +
			`- avg_offset: ${parsed.avg_offset}\n` +
			`- allow_react: ${parsed.allow_react}\n` +
			`- custom_instructions: ${parsed.custom_instructions || "(なし)"}`,
	);
};

const getChannelPolicyHandler: ToolHandler = async (args, ctx) => {
	const channelId = (args.channel_id as string | undefined) ?? ctx.channel.id;
	const guildId = ctx.guild.id;

	const ch = ctx.guild.channels.cache.get(channelId);
	const channelName = ch ? `#${ch.name}` : channelId;

	const policy = getChannelPolicy(guildId, channelId);
	if (!policy) {
		return ok(
			`${channelName} にはカスタムポリシーが設定されていません（デフォルト動作）`,
		);
	}

	return ok(
		`${channelName} のポリシー:\n` +
			`- 説明: ${policy.original_description}\n` +
			`- avg_offset: ${policy.avg_offset}\n` +
			`- allow_react: ${policy.allow_react}\n` +
			`- custom_instructions: ${policy.custom_instructions || "(なし)"}\n` +
			`- last_updated: ${policy.last_updated}`,
	);
};

const removeChannelPolicyHandler: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	if (!channelId) return fail("channel_id is required");

	const guildId = ctx.guild.id;
	const data = loadChannelPolicies(guildId);

	const idx = data.policies.findIndex((p) => p.channel_id === channelId);
	if (idx === -1) {
		return fail(`チャンネル ${channelId} にはポリシーが設定されていません`);
	}

	data.policies.splice(idx, 1);
	saveChannelPolicies(guildId, data);

	const ch = ctx.guild.channels.cache.get(channelId);
	const channelName = ch ? `#${ch.name}` : channelId;

	return ok(
		`${channelName} のポリシーを削除しました（デフォルト動作に戻ります）`,
	);
};

export const channelPolicyTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "set_channel_policy",
				description:
					"チャンネルの反応方針を自然言語で設定する。LLM が構造化パラメータに変換して保存する",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "対象チャンネルの ID",
						},
						description: {
							type: "string",
							description:
								"方針の自然言語記述（例: 「技術的な質問には積極的に回答するが雑談は控えめに」）",
						},
					},
					required: ["channel_id", "description"],
				},
			},
		},
		handler: setChannelPolicyHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "get_channel_policy",
				description: "チャンネルのポリシーを確認する。省略時は現在のチャンネル",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "対象チャンネルの ID（省略時は現在のチャンネル）",
						},
					},
				},
			},
		},
		handler: getChannelPolicyHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "remove_channel_policy",
				description: "チャンネルのポリシーを削除してデフォルト動作に戻す",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "対象チャンネルの ID",
						},
					},
					required: ["channel_id"],
				},
			},
		},
		handler: removeChannelPolicyHandler,
	},
];
