import type { AgentContext } from "../../src/agent/types.ts";

/**
 * テスト用の AgentContext を生成する。
 * discord.js の Guild / Channel / Message を最小限のモックで再現。
 */
export function createMockContext(
	overrides?: Partial<AgentContext>,
): AgentContext {
	const guild = {
		id: "test-guild-123",
		channels: { cache: new Map() },
	} as unknown as AgentContext["guild"];

	const channel = {
		id: "test-channel-123",
		isSendable: () => true,
		send: async () => ({}),
		sendTyping: async () => {},
	} as unknown as AgentContext["channel"];

	const triggerMessage = {
		id: "test-message-123",
		content: "test message",
		author: {
			id: "test-user-123",
			username: "test-user",
			bot: false,
		},
		channel,
		guild,
		reply: async () => ({}),
		react: async () => ({}),
	} as unknown as AgentContext["triggerMessage"];

	return {
		triggerMessage,
		channel,
		guild,
		triggeredBy: "triage",
		isMentioned: false,
		...overrides,
	};
}
