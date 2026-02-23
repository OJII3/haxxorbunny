import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
	getActiveChannelIds,
	getLastBotAction,
	getRecentMessages,
	saveBotAction,
	saveMessage,
	searchBotActions,
	searchMessages,
} from "../../src/db/queries.ts";
import { cleanupDb, createTestTables } from "../helpers/test-db.ts";

beforeAll(() => {
	createTestTables();
});

afterEach(() => {
	cleanupDb();
});

describe("saveMessage + getRecentMessages", () => {
	test("保存したメッセージを取得できる", () => {
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u1",
			username: "alice",
			content: "hello",
			isBot: false,
		});
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u2",
			username: "bob",
			content: "world",
			isBot: false,
		});

		const msgs = getRecentMessages("ch1");
		expect(msgs).toHaveLength(2);
		const contents = msgs.map((m) => m.content);
		expect(contents).toContain("hello");
		expect(contents).toContain("world");
	});

	test("limit で取得件数を制限できる", () => {
		for (let i = 0; i < 5; i++) {
			saveMessage({
				guildId: "g1",
				channelId: "ch1",
				userId: "u1",
				username: "alice",
				content: `msg-${i}`,
				isBot: false,
			});
		}

		const msgs = getRecentMessages("ch1", 3);
		expect(msgs).toHaveLength(3);
	});
});

describe("searchMessages", () => {
	test("keyword でフィルタできる", () => {
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u1",
			username: "alice",
			content: "TypeScript is great",
			isBot: false,
		});
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u2",
			username: "bob",
			content: "I like Python",
			isBot: false,
		});

		const results = searchMessages({
			guildId: "g1",
			keyword: "TypeScript",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.username).toBe("alice");
	});

	test("username でフィルタできる", () => {
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u1",
			username: "alice",
			content: "hello",
			isBot: false,
		});
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u2",
			username: "bob",
			content: "world",
			isBot: false,
		});

		const results = searchMessages({
			guildId: "g1",
			username: "bob",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.content).toBe("world");
	});

	test("botOnly でフィルタできる", () => {
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "u1",
			username: "human",
			content: "hi",
			isBot: false,
		});
		saveMessage({
			guildId: "g1",
			channelId: "ch1",
			userId: "b1",
			username: "bot",
			content: "beep",
			isBot: true,
		});

		const results = searchMessages({
			guildId: "g1",
			botOnly: true,
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.username).toBe("bot");
	});

	test("limit が最大 50 に制限される", () => {
		for (let i = 0; i < 55; i++) {
			saveMessage({
				guildId: "g1",
				channelId: "ch1",
				userId: "u1",
				username: "alice",
				content: `msg-${i}`,
				isBot: false,
			});
		}

		const results = searchMessages({ guildId: "g1", limit: 100 });
		expect(results).toHaveLength(50);
	});
});

describe("saveBotAction + getLastBotAction", () => {
	test("アクションを保存して取得できる", () => {
		saveBotAction({
			guildId: "g1",
			action: "send_message",
			channelId: "ch1",
			content: "first",
			triggeredBy: "triage",
		});

		const last = getLastBotAction("ch1");
		expect(last).not.toBeNull();
		expect(last?.action).toBe("send_message");
		expect(last?.triggeredBy).toBe("triage");
	});

	test("存在しないチャンネルは null を返す", () => {
		const last = getLastBotAction("nonexistent");
		expect(last).toBeNull();
	});
});

describe("searchBotActions", () => {
	test("action でフィルタできる", () => {
		saveBotAction({
			guildId: "g1",
			action: "send_message",
			channelId: "ch1",
			triggeredBy: "triage",
		});
		saveBotAction({
			guildId: "g1",
			action: "add_reaction",
			channelId: "ch1",
			triggeredBy: "triage",
		});

		const results = searchBotActions({
			guildId: "g1",
			action: "send_message",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.action).toBe("send_message");
	});

	test("triggeredBy でフィルタできる", () => {
		saveBotAction({
			guildId: "g1",
			action: "send_message",
			channelId: "ch1",
			triggeredBy: "triage",
		});
		saveBotAction({
			guildId: "g1",
			action: "send_message",
			channelId: "ch1",
			triggeredBy: "cron",
		});

		const results = searchBotActions({
			guildId: "g1",
			triggeredBy: "cron",
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.triggeredBy).toBe("cron");
	});

	test("limit が最大 30 に制限される", () => {
		for (let i = 0; i < 35; i++) {
			saveBotAction({
				guildId: "g1",
				action: "send_message",
				channelId: "ch1",
				triggeredBy: "triage",
			});
		}

		const results = searchBotActions({ guildId: "g1", limit: 100 });
		expect(results).toHaveLength(30);
	});
});

describe("getActiveChannelIds", () => {
	test("24時間以内のアクティブチャンネルを取得できる", () => {
		saveMessage({
			guildId: "g1",
			channelId: "ch-active",
			userId: "u1",
			username: "alice",
			content: "recent",
			isBot: false,
		});

		const ids = getActiveChannelIds("g1");
		expect(ids).toContain("ch-active");
	});

	test("limit でチャンネル数を制限できる", () => {
		for (let i = 0; i < 10; i++) {
			saveMessage({
				guildId: "g1",
				channelId: `ch-${i}`,
				userId: "u1",
				username: "alice",
				content: "msg",
				isBot: false,
			});
		}

		const ids = getActiveChannelIds("g1", 3);
		expect(ids).toHaveLength(3);
	});
});
