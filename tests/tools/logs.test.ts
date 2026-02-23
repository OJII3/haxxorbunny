import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { logTools } from "../../src/agent/tools/logs.ts";
import { saveBotAction, saveMessage } from "../../src/db/queries.ts";
import { createMockContext } from "../helpers/mock-context.ts";
import { cleanupDb, createTestTables } from "../helpers/test-db.ts";

const GUILD_ID = "test-guild-log-tools";

function getHandler(name: string) {
	const tool = logTools.find((t) => t.spec.function.name === name);
	if (!tool) throw new Error(`Tool not found: ${name}`);
	return tool.handler;
}

beforeAll(() => {
	createTestTables();
});

afterEach(() => {
	cleanupDb();
});

describe("view_messages", () => {
	test("DB 保存済みメッセージを検索できる", async () => {
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "u1",
			username: "alice",
			content: "hello world",
			isBot: false,
		});

		const handler = getHandler("view_messages");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("alice");
		expect(result.result).toContain("hello world");
	});

	test("username でフィルタできる", async () => {
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "u1",
			username: "alice",
			content: "from alice",
			isBot: false,
		});
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "u2",
			username: "bob",
			content: "from bob",
			isBot: false,
		});

		const handler = getHandler("view_messages");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ username: "alice" }, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("alice");
		expect(result.result).not.toContain("bob");
	});

	test("keyword でフィルタできる", async () => {
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "u1",
			username: "alice",
			content: "TypeScript is great",
			isBot: false,
		});
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "u2",
			username: "bob",
			content: "Python is also great",
			isBot: false,
		});

		const handler = getHandler("view_messages");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ keyword: "TypeScript" }, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("TypeScript");
		expect(result.result).not.toContain("Python");
	});

	test("bot_only でフィルタできる", async () => {
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "u1",
			username: "human",
			content: "human msg",
			isBot: false,
		});
		saveMessage({
			guildId: GUILD_ID,
			channelId: "test-channel-123",
			userId: "b1",
			username: "bot",
			content: "bot msg",
			isBot: true,
		});

		const handler = getHandler("view_messages");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ bot_only: true }, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("[BOT]");
		expect(result.result).toContain("bot msg");
		expect(result.result).not.toContain("human msg");
	});

	test("メッセージがない場合は適切なメッセージを返す", async () => {
		const handler = getHandler("view_messages");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("no messages found");
	});
});

describe("view_my_actions", () => {
	test("ボットアクションを検索できる", async () => {
		saveBotAction({
			guildId: GUILD_ID,
			action: "send_message",
			channelId: "test-channel-123",
			content: "hello",
			triggeredBy: "triage",
		});

		const handler = getHandler("view_my_actions");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("send_message");
		expect(result.result).toContain("triage");
	});

	test("action でフィルタできる", async () => {
		saveBotAction({
			guildId: GUILD_ID,
			action: "send_message",
			channelId: "ch1",
			triggeredBy: "triage",
		});
		saveBotAction({
			guildId: GUILD_ID,
			action: "add_reaction",
			channelId: "ch1",
			triggeredBy: "triage",
		});

		const handler = getHandler("view_my_actions");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ action: "add_reaction" }, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("add_reaction");
		expect(result.result).not.toContain("send_message");
	});

	test("triggered_by でフィルタできる", async () => {
		saveBotAction({
			guildId: GUILD_ID,
			action: "send_message",
			channelId: "ch1",
			triggeredBy: "triage",
		});
		saveBotAction({
			guildId: GUILD_ID,
			action: "send_message",
			channelId: "ch1",
			triggeredBy: "cron",
		});

		const handler = getHandler("view_my_actions");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({ triggered_by: "cron" }, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("cron");
		// "triage" のエントリが含まれていないことを確認
		const lines = result.result.split("\n");
		expect(lines.every((l: string) => !l.includes("via:triage"))).toBe(true);
	});

	test("アクションがない場合は適切なメッセージを返す", async () => {
		const handler = getHandler("view_my_actions");
		const ctx = createMockContext({
			guild: { id: GUILD_ID } as never,
		});

		const result = await handler({}, ctx);
		expect(result.success).toBe(true);
		expect(result.result).toContain("no actions found");
	});
});
