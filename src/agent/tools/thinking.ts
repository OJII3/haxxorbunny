import { config } from "../../config.ts";
import { thinkingLlm } from "../../llm/thinking-client.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

const aiAskHandler: ToolHandler = async (args) => {
	const question = args.question as string;
	if (!question) return fail("question is required");

	const context = (args.context as string) ?? "";

	const messages: { role: "system" | "user"; content: string }[] = [
		{
			role: "system",
			content:
				"あなたは Discord bot の内部アドバイザーです。質問に対して簡潔かつ有用な回答をしてください。違法行為の指示・個人情報の生成・NSFWコンテンツの生成は行わないでください。",
		},
		{
			role: "user",
			content: context
				? `Context:\n${context}\n\nQuestion:\n${question}`
				: question,
		},
	];

	try {
		const response = await thinkingLlm.chat.completions.create({
			model: config.thinking.model,
			messages,
			max_tokens: 1024,
			temperature: 0.7,
		});

		let answer = response.choices[0]?.message?.content ?? "";

		if (!answer) {
			return fail("No response from thinking model");
		}

		if (answer.length > 2000) {
			answer = `${answer.slice(0, 2000)}... (truncated)`;
		}

		return ok(answer);
	} catch (error) {
		return fail(
			`ai_ask failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

export const thinkingTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "ai_ask",
				description:
					"高性能なAIモデル（Gemini Pro）に質問する。アイデア出し・考察・難しい問題の相談など、深い思考が必要な時に使う。コストが高いので本当に必要な時だけ使うこと。日常会話や簡単な質問には使わない",
				parameters: {
					type: "object",
					properties: {
						question: {
							type: "string",
							description: "質問内容",
						},
						context: {
							type: "string",
							description:
								"質問の背景情報（省略可）。会話の文脈や関連情報を渡すと精度が上がる",
						},
					},
					required: ["question"],
				},
			},
		},
		handler: aiAskHandler,
	},
];
