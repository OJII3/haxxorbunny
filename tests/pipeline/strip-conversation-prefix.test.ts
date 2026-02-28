import { describe, expect, test } from "bun:test";
import { stripConversationPrefix } from "../../src/pipeline/generation.ts";

describe("stripConversationPrefix", () => {
	test("プレフィックス付きテキストからプレフィックスを除去する", () => {
		expect(stripConversationPrefix("[02/28 15:00 太郎]: こんにちは")).toBe(
			"こんにちは",
		);
	});

	test("プレフィックスなしのテキストはそのまま返す", () => {
		expect(stripConversationPrefix("ただのテキスト")).toBe("ただのテキスト");
	});

	test("コロンなしのプレフィックスも除去する", () => {
		expect(stripConversationPrefix("[02/28 15:00 太郎] こんにちは")).toBe(
			"こんにちは",
		);
	});

	test("角括弧を含む通常テキストは誤除去しない", () => {
		expect(stripConversationPrefix("[重要] お知らせ")).toBe("[重要] お知らせ");
	});

	test("複数行のプレフィックスを各行で除去する", () => {
		const input = "[02/28 15:00 太郎]: こんにちは\n[02/28 15:01 花子]: やあ";
		expect(stripConversationPrefix(input)).toBe("こんにちは\nやあ");
	});

	test("bot 名のプレフィックスを除去する", () => {
		expect(stripConversationPrefix("[02/28 19:02 世界の泡の住人]: 無理")).toBe(
			"無理",
		);
	});

	test("二重プレフィックスを除去する", () => {
		const input =
			"[02/28 19:02 世界の泡の住人]: [02/28 19:02 世界の泡の住人]: 無理";
		const result = stripConversationPrefix(input);
		// 行頭のプレフィックスのみ除去される
		expect(result).toBe("[02/28 19:02 世界の泡の住人]: 無理");
	});

	test("空文字列はそのまま返す", () => {
		expect(stripConversationPrefix("")).toBe("");
	});
});
