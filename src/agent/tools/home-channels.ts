import { loadHomeChannels, saveHomeChannels } from "../../llm/home-channels.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const listHomeChannelsHandler: ToolHandler = async (_args, ctx) => {
	const guildId = ctx.guild.id;
	const data = loadHomeChannels(guildId);

	if (data.channel_ids.length === 0) {
		return ok(
			"ホームチャンネル未設定（全チャンネルがホーム扱い）。add_home_channel で追加できます。",
		);
	}

	const lines = data.channel_ids.map((id) => {
		const ch = ctx.guild.channels.cache.get(id);
		return ch ? `- #${ch.name} (${id})` : `- (不明なチャンネル: ${id})`;
	});

	return ok(
		`ホームチャンネル (${data.channel_ids.length}件):\n${lines.join("\n")}\nlast_updated: ${data.last_updated || "never"}`,
	);
};

const addHomeChannelHandler: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	if (!channelId) return fail("channel_id is required");

	const guildId = ctx.guild.id;

	// チャンネル存在チェック
	const ch = ctx.guild.channels.cache.get(channelId);
	if (!ch) return fail(`チャンネル ${channelId} が見つかりません`);

	const data = loadHomeChannels(guildId);

	if (data.channel_ids.includes(channelId)) {
		return ok(`#${ch.name} は既にホームチャンネルです`);
	}

	data.channel_ids.push(channelId);
	saveHomeChannels(guildId, data);

	return ok(`#${ch.name} をホームチャンネルに追加しました`);
};

const removeHomeChannelHandler: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	if (!channelId) return fail("channel_id is required");

	const guildId = ctx.guild.id;
	const data = loadHomeChannels(guildId);

	const idx = data.channel_ids.indexOf(channelId);
	if (idx === -1) {
		return fail(`チャンネル ${channelId} はホームチャンネルに含まれていません`);
	}

	data.channel_ids.splice(idx, 1);
	saveHomeChannels(guildId, data);

	const ch = ctx.guild.channels.cache.get(channelId);
	const name = ch ? `#${ch.name}` : channelId;

	return ok(`${name} をホームチャンネルから削除しました`);
};

export const homeChannelTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "list_home_channels",
				description:
					"ホームチャンネル一覧を表示する。ホームチャンネルでは積極的に会話に参加する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: listHomeChannelsHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "add_home_channel",
				description:
					"チャンネルをホームチャンネルに追加する。ホームチャンネルでは積極的に会話に参加する",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "追加するチャンネルの ID",
						},
					},
					required: ["channel_id"],
				},
			},
		},
		handler: addHomeChannelHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "remove_home_channel",
				description: "チャンネルをホームチャンネルから削除する",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "削除するチャンネルの ID",
						},
					},
					required: ["channel_id"],
				},
			},
		},
		handler: removeHomeChannelHandler,
	},
];
