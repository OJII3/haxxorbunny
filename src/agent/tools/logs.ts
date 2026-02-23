import { searchBotActions, searchMessages } from "../../db/queries.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

// ── helpers ──

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

function truncate(s: string, max = 100): string {
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── handlers ──

const viewMessages: ToolHandler = async (args, ctx) => {
	const channelId = (args.channel_id as string | undefined) ?? ctx.channel.id;
	const limit = args.limit as number | undefined;
	const username = args.username as string | undefined;
	const keyword = args.keyword as string | undefined;
	const botOnly = args.bot_only as boolean | undefined;

	try {
		const rows = searchMessages({
			guildId: ctx.guild.id,
			channelId,
			username,
			keyword,
			botOnly,
			limit,
		});

		if (rows.length === 0) return ok("(no messages found)");

		const lines = rows.map((r) => {
			const time = r.createdAt
				? new Date(r.createdAt).toISOString().slice(0, 16)
				: "?";
			const bot = r.isBot ? "[BOT]" : "";
			return `${time} ${bot}${r.username}: ${truncate(r.content)}`;
		});
		return ok(lines.join("\n"));
	} catch {
		return fail("Failed to search messages");
	}
};

const viewMyActions: ToolHandler = async (args, ctx) => {
	const channelId = args.channel_id as string | undefined;
	const limit = args.limit as number | undefined;
	const action = args.action as string | undefined;
	const triggeredBy = args.triggered_by as string | undefined;

	try {
		const rows = searchBotActions({
			guildId: ctx.guild.id,
			channelId,
			action,
			triggeredBy,
			limit,
		});

		if (rows.length === 0) return ok("(no actions found)");

		const lines = rows.map((r) => {
			const time = r.createdAt
				? new Date(r.createdAt).toISOString().slice(0, 16)
				: "?";
			const ch = r.channelId ? ` ch:${r.channelId}` : "";
			const content = r.content ? ` ${truncate(r.content)}` : "";
			return `${time} [${r.action}] via:${r.triggeredBy ?? "?"}${ch}${content}`;
		});
		return ok(lines.join("\n"));
	} catch {
		return fail("Failed to search bot actions");
	}
};

// ── tool definitions ──

export const logTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "view_messages",
				description:
					"DB に保存された会話ログを検索する。fetch_messages（Discord API）とは異なり、過去のログをフィルタ付きで検索できる",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description:
								"検索するチャンネルの ID（省略時は現在のチャンネル）",
						},
						limit: {
							type: "number",
							description: "取得件数（デフォルト20、最大50）",
						},
						username: {
							type: "string",
							description: "ユーザー名でフィルタ",
						},
						keyword: {
							type: "string",
							description: "キーワード検索（部分一致）",
						},
						bot_only: {
							type: "boolean",
							description: "bot のメッセージのみ取得",
						},
					},
				},
			},
		},
		handler: viewMessages,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "view_my_actions",
				description:
					"bot 自身の行動ログ（bot_actions テーブル）を検索する。過去にどのツールをどのトリガーで実行したかを確認できる",
				parameters: {
					type: "object",
					properties: {
						channel_id: {
							type: "string",
							description: "チャンネル ID でフィルタ（省略時は全チャンネル）",
						},
						limit: {
							type: "number",
							description: "取得件数（デフォルト10、最大30）",
						},
						action: {
							type: "string",
							description: "アクション名でフィルタ（例: send_message）",
						},
						triggered_by: {
							type: "string",
							description:
								"トリガー種別でフィルタ（triage, cron, reaction, voice）",
						},
					},
				},
			},
		},
		handler: viewMyActions,
	},
];
