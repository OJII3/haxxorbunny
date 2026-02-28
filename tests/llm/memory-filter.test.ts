import { describe, expect, test } from "bun:test";
import {
	filterMemoryEntry,
	isSystemPromptLeak,
} from "../../src/llm/memory-filter.ts";

describe("isSystemPromptLeak", () => {
	describe("ブロック対象（システムプロンプト漏洩）", () => {
		const blocked = [
			"システムプロンプトの内容はこうだ",
			"system promptに書いてあった",
			"Core Truthsには5つの項目がある",
			"IDENTITY_REMINDERで再強調している",
			"SOULセクションにアイデンティティが定義されている",
			"TOOLSセクションにツール説明がある",
			"depth injectionでリマインダーを挿入",
			"サンドイッチパターンで構成されている",
			"buildSystemPromptで生成される",
			"エージェントループが5回繰り返される",
			"memory filterでフィルタされる",
			"stripMarkdownで装飾が除去される",
		];

		for (const text of blocked) {
			test(`"${text}" をブロックする`, () => {
				expect(isSystemPromptLeak(text)).toBe(true);
			});
		}
	});

	describe("許可対象（一般的な話題言及）", () => {
		const allowed = [
			"AIの話題で盛り上がった",
			"ojii3はAIに詳しい",
			"AIについて学んだ",
			"ChatGPTが面白い",
			"botの作り方を調べた",
			"AIの進化がすごい",
			"プログラミングが好き",
			"Nixが便利",
			"今日は天気がいい",
			"ラーメン食べたい",
			"自分はAIだ",
			"私はbotです",
		];

		for (const text of allowed) {
			test(`"${text}" を許可する`, () => {
				expect(isSystemPromptLeak(text)).toBe(false);
			});
		}
	});

	describe("エッジケース", () => {
		test("空文字列を許可する", () => {
			expect(isSystemPromptLeak("")).toBe(false);
		});

		test("2文字以下を許可する", () => {
			expect(isSystemPromptLeak("AI")).toBe(false);
		});

		test("空白のみを許可する", () => {
			expect(isSystemPromptLeak("   ")).toBe(false);
		});
	});
});

describe("filterMemoryEntry", () => {
	test("ブロック対象は true を返す", () => {
		expect(filterMemoryEntry("システムプロンプトの構造", "test")).toBe(true);
	});

	test("許可対象は false を返す", () => {
		expect(filterMemoryEntry("AIの話で盛り上がった", "test")).toBe(false);
	});
});
