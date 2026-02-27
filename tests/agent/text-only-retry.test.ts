import { describe, expect, test } from "bun:test";
import { buildTextOnlyRetryPrompt } from "../../src/agent/loop.ts";

describe("buildTextOnlyRetryPrompt", () => {
	test("テキストがある場合、応答内容を引用したプロンプトを返す", () => {
		const result = buildTextOnlyRetryPrompt("こんにちは！元気ですか？");
		expect(result).toContain("こんにちは！元気ですか？");
		expect(result).toContain("reply_to_message");
		expect(result).toContain("send_message");
		expect(result).toContain("do_nothing");
		expect(result).toContain("あなたの応答内容");
	});

	test("テキストが空文字の場合、汎用プロンプトを返す", () => {
		const result = buildTextOnlyRetryPrompt("");
		expect(result).not.toContain("あなたの応答内容");
		expect(result).toContain("send_message");
		expect(result).toContain("reply_to_message");
		expect(result).toContain("do_nothing");
	});

	test("テキストが null の場合、汎用プロンプトを返す", () => {
		const result = buildTextOnlyRetryPrompt(null);
		expect(result).not.toContain("あなたの応答内容");
		expect(result).toContain("do_nothing");
	});

	test("空白のみのテキストは空文字として扱われ、汎用プロンプトを返す", () => {
		const result = buildTextOnlyRetryPrompt("   \n\t  ");
		expect(result).not.toContain("あなたの応答内容");
		expect(result).toContain("do_nothing");
	});

	test("1000文字を超えるテキストは切り詰められる", () => {
		const longText = "あ".repeat(1500);
		const result = buildTextOnlyRetryPrompt(longText);
		expect(result).toContain("あなたの応答内容");
		// 1000文字に切り詰められていることを確認
		const truncated = "あ".repeat(1000);
		expect(result).toContain(truncated);
		expect(result).not.toContain("あ".repeat(1001));
	});

	test("ちょうど1000文字のテキストはそのまま含まれる", () => {
		const exactText = "x".repeat(1000);
		const result = buildTextOnlyRetryPrompt(exactText);
		expect(result).toContain(exactText);
		expect(result).toContain("あなたの応答内容");
	});
});
