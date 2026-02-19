import { voiceManager } from "../../voice/manager.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const voiceReply: ToolHandler = async (args, ctx) => {
	const content = args.content as string;
	if (!content) return fail("content is required");

	const session = voiceManager.getSession(ctx.guild.id);
	if (!session) return fail("No active voice session");

	try {
		await session.speak(content);
		return ok(`Spoke in voice: "${content}"`);
	} catch (error) {
		return fail(
			`TTS failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

const leaveVoice: ToolHandler = async (_args, ctx) => {
	const session = voiceManager.getSession(ctx.guild.id);
	if (!session) return fail("No active voice session");

	voiceManager.endSession(ctx.guild.id, "leave_command");
	return ok("Left voice channel");
};

export const voiceTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "voice_reply",
				description:
					"ボイスチャンネルで音声として返答する。テキストを TTS で再生する（50文字以内推奨）",
				parameters: {
					type: "object",
					properties: {
						content: {
							type: "string",
							description: "話す内容（50文字以内推奨。長いと再生に時間がかかる）",
						},
					},
					required: ["content"],
				},
			},
		},
		handler: voiceReply,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "leave_voice",
				description: "ボイスチャンネルから退出する",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		handler: leaveVoice,
	},
];
