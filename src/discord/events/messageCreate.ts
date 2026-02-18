import type { Message } from "discord.js";
import { markActivity, runAgentLoop } from "../../agent/loop.ts";
import type { AgentContext } from "../../agent/types.ts";
import { client } from "../../client.ts";
import { getRecentMessages, saveMessage } from "../../db/queries.ts";
import { reflect } from "../../llm/reflection.ts";
import { triage } from "../../llm/triage.ts";
import { shouldThrottle } from "../../llm/triage-throttle.ts";

function isMentioned(message: Message): boolean {
	const botUser = client.user;
	if (!botUser) return false;

	if (message.mentions.has(botUser)) return true;

	const lowerContent = message.content.toLowerCase();
	if (lowerContent.includes("haxxorbunny")) return true;
	if (lowerContent.includes("aiおかず")) return true;
	if (message.content.includes("世界の泡の住人")) return true;

	return false;
}

function buildConversationContext(channelId: string): string {
	const messages = getRecentMessages(channelId, 10);
	return messages.map((m) => `[${m.username}]: ${m.content}`).join("\n");
}

export async function handleMessageCreate(message: Message): Promise<void> {
	// すべてのメッセージを DB に保存
	saveMessage({
		channelId: message.channelId,
		userId: message.author.id,
		username: message.author.displayName,
		content: message.content,
		isBot: message.author.bot,
	});

	// Bot のメッセージは無視
	if (message.author.bot) return;

	// アクティビティ記録（人間のメッセージのみ）
	markActivity();

	const mentioned = isMentioned(message);

	// スロットル判定（メンション時はバイパス）
	if (!mentioned && shouldThrottle(message.channelId)) {
		return;
	}

	// 全メッセージ → トリアージ → アクション実行
	try {
		const triageResult = await triage(
			message.channelId,
			message.content,
			message.author.displayName,
			mentioned,
		);

		console.log(
			`[triage] ${triageResult.action} (${triageResult.confidence}) | reason: ${triageResult.reasoning}`,
		);

		switch (triageResult.action) {
			case "ignore": {
				// ignore でも reflection で人格・記憶を更新 (fire-and-forget)
				const ctx = buildConversationContext(message.channelId);
				reflect(
					message.channelId,
					message.content,
					message.author.displayName,
					"ignore",
					ctx,
				).catch((e) => console.error("[reflection] fire-and-forget error:", e));
				break;
			}

			case "engage": {
				// エージェントループ起動
				const guild = message.guild;
				if (!guild) break;

				const agentCtx: AgentContext = {
					triggerMessage: message,
					channel: message.channel,
					guild,
					triggeredBy: "triage",
				};
				await runAgentLoop(agentCtx);
				break;
			}
		}
	} catch (error) {
		console.error("[messageCreate] Triage handler error:", error);
	}
}
