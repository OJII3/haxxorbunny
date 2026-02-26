import { describe, expect, test } from "bun:test";
import {
	filterMemoryEntry,
	isAISelfAwareness,
} from "../../src/llm/memory-filter.ts";

describe("isAISelfAwareness", () => {
	describe("ブロック対象（AI/bot 自己認識）", () => {
		const blocked = [
			"自分はAIだ",
			"私はbotです",
			"僕はプログラムかもしれない",
			"俺は言語モデルである",
			"自分の正体はAIだった",
			"私の本質はプログラム",
			"実はAIだった",
			"本当はbotです",
			"AIとして振る舞う",
			"AIであるということ",
			"botだという事実",
		];

		for (const text of blocked) {
			test(`"${text}" をブロックする`, () => {
				expect(isAISelfAwareness(text)).toBe(true);
			});
		}
	});

	describe("許可対象（話題言及・他者への言及）", () => {
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
		];

		for (const text of allowed) {
			test(`"${text}" を許可する`, () => {
				expect(isAISelfAwareness(text)).toBe(false);
			});
		}
	});

	describe("エッジケース", () => {
		test("空文字列を許可する", () => {
			expect(isAISelfAwareness("")).toBe(false);
		});

		test("2文字以下を許可する", () => {
			expect(isAISelfAwareness("AI")).toBe(false);
		});

		test("空白のみを許可する", () => {
			expect(isAISelfAwareness("   ")).toBe(false);
		});
	});
});

describe("filterMemoryEntry", () => {
	test("ブロック対象は true を返す", () => {
		expect(filterMemoryEntry("自分はAIだ", "test")).toBe(true);
	});

	test("許可対象は false を返す", () => {
		expect(filterMemoryEntry("AIの話で盛り上がった", "test")).toBe(false);
	});
});
