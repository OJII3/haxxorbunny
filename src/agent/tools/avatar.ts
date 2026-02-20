import { readFileSync } from "node:fs";
import { client } from "../../client.ts";
import {
	avatarImageExists,
	getAvatarImagePath,
	getCooldownRemaining,
	isOnCooldown,
	loadManifest,
	loadState,
	recordChange,
} from "../../llm/avatar.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const listAvatarsHandler: ToolHandler = async () => {
	const manifest = loadManifest();
	if (manifest.avatars.length === 0) {
		return ok(
			"アバター画像が登録されていません。data/avatars/ に画像を配置し manifest.json に登録してください。",
		);
	}

	const state = loadState();
	const lines = manifest.avatars.map((a) => {
		const isCurrent = a.id === state.current_avatar_id ? " [現在]" : "";
		const exists = avatarImageExists(a.filename) ? "" : " [画像なし]";
		return `- ${a.id}: ${a.name} — ${a.description} (tags: ${a.tags.join(", ")})${isCurrent}${exists}`;
	});

	return ok(`使用可能なアバター:\n${lines.join("\n")}`);
};

const changeAvatarHandler: ToolHandler = async (args, ctx) => {
	const avatarId = args.avatar_id as string;
	const reason = args.reason as string;

	if (!avatarId || !reason) {
		return fail("avatar_id と reason は必須です");
	}

	const state = loadState();

	// 同じアバターへの変更は API を呼ばず即座に成功
	if (state.current_avatar_id === avatarId) {
		return ok(`既に ${avatarId} を使用中です。変更不要。`);
	}

	if (isOnCooldown()) {
		const remaining = Math.ceil(getCooldownRemaining() / 60_000);
		return fail(
			`クールダウン中です。あと約${remaining}分後に変更可能になります。`,
		);
	}

	const manifest = loadManifest();
	const avatar = manifest.avatars.find((a) => a.id === avatarId);
	if (!avatar) {
		const ids = manifest.avatars.map((a) => a.id).join(", ");
		return fail(
			`アバター "${avatarId}" が見つかりません。利用可能: ${ids || "(なし)"}`,
		);
	}

	if (!avatarImageExists(avatar.filename)) {
		return fail(
			`画像ファイル "${avatar.filename}" が data/avatars/ に見つかりません。`,
		);
	}

	try {
		const imageBuffer = readFileSync(getAvatarImagePath(avatar.filename));
		const base64 = imageBuffer.toString("base64");
		const ext = avatar.filename.split(".").pop()?.toLowerCase();
		const mime =
			ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
		const dataUri = `data:${mime};base64,${base64}`;

		await client.user?.setAvatar(dataUri);
		recordChange(avatarId, reason, ctx.triggeredBy);

		return ok(
			`アバターを "${avatar.name}" (${avatarId}) に変更しました。理由: ${reason}`,
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("429") || msg.includes("rate limit")) {
			return fail(
				"Discord API のレート制限に達しました。しばらく待ってから再試行してください。",
			);
		}
		return fail(`アバター変更に失敗しました: ${msg}`);
	}
};

const getAvatarStatusHandler: ToolHandler = async () => {
	const state = loadState();
	const remaining = getCooldownRemaining();
	const cooldownText =
		remaining > 0
			? `クールダウン中（あと約${Math.ceil(remaining / 60_000)}分）`
			: "変更可能";

	const current = state.current_avatar_id ?? "未設定";
	const lastChanged = state.last_changed_at ?? "なし";

	return ok(
		`現在のアバター: ${current}\n最終変更: ${lastChanged}\nステータス: ${cooldownText}`,
	);
};

export const avatarTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "list_avatars",
				description:
					"使用可能なアバター画像の一覧を表示する。ID、名前、説明、タグ、現在使用中かどうかを確認できる",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: listAvatarsHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "change_avatar",
				description:
					"プロフィール画像を変更する。気分や話題に合わせて自然に変える。30分のクールダウンあり",
				parameters: {
					type: "object",
					properties: {
						avatar_id: {
							type: "string",
							description: "変更先のアバターID（list_avatars で確認可能）",
						},
						reason: {
							type: "string",
							description: "変更理由（記録用）",
						},
					},
					required: ["avatar_id", "reason"],
				},
			},
		},
		handler: changeAvatarHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "get_avatar_status",
				description: "現在のアバター情報とクールダウン残り時間を確認する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: getAvatarStatusHandler,
	},
];
