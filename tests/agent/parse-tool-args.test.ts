import { describe, expect, test } from "bun:test";
import { parseToolArguments } from "../../src/agent/loop.ts";

describe("parseToolArguments", () => {
	test("正常な JSON をそのままパースする", () => {
		const result = parseToolArguments('{"entry":"hello","emotional_impact":3}');
		expect(result).toEqual({ entry: "hello", emotional_impact: 3 });
	});

	test("空オブジェクト {} をパースする", () => {
		const result = parseToolArguments("{}");
		expect(result).toEqual({});
	});

	test("連結された2つの JSON から先頭のみ抽出する", () => {
		const raw =
			'{"entry":"memory","emotional_impact":5}{"title":"goal","description":"desc"}';
		const result = parseToolArguments(raw);
		expect(result).toEqual({ entry: "memory", emotional_impact: 5 });
	});

	test("連結された3つ以上の JSON から先頭のみ抽出する", () => {
		const raw =
			'{"entry":"a","emotional_impact":5}{"title":"b","description":"c"}{"url":"https://example.com"}';
		const result = parseToolArguments(raw);
		expect(result).toEqual({ entry: "a", emotional_impact: 5 });
	});

	test("文字列内のブレースを正しく処理する", () => {
		const raw =
			'{"content":"hello { world } test"}{"extra":"should be ignored"}';
		const result = parseToolArguments(raw);
		expect(result).toEqual({ content: "hello { world } test" });
	});

	test("文字列内のエスケープされた引用符を正しく処理する", () => {
		const raw = '{"content":"she said \\"hello\\""}{"extra":"ignored"}';
		const result = parseToolArguments(raw);
		expect(result).toEqual({ content: 'she said "hello"' });
	});

	test("ネストされたオブジェクトを含む JSON を正しく処理する", () => {
		const raw = '{"fields":[{"name":"a","value":"b"}]}{"extra":"ignored"}';
		const result = parseToolArguments(raw);
		expect(result).toEqual({ fields: [{ name: "a", value: "b" }] });
	});

	test("不正な文字列で SyntaxError を投げる", () => {
		expect(() => parseToolArguments("not json")).toThrow(SyntaxError);
	});

	test("空文字列で SyntaxError を投げる", () => {
		expect(() => parseToolArguments("")).toThrow(SyntaxError);
	});

	test("閉じブレースがない不完全な JSON で SyntaxError を投げる", () => {
		expect(() => parseToolArguments('{"key":"value"')).toThrow(SyntaxError);
	});

	test("配列の JSON で SyntaxError を投げる", () => {
		expect(() => parseToolArguments("[1,2,3]")).toThrow(SyntaxError);
	});

	test("null で SyntaxError を投げる", () => {
		expect(() => parseToolArguments("null")).toThrow(SyntaxError);
	});

	test("プリミティブ値で SyntaxError を投げる", () => {
		expect(() => parseToolArguments("42")).toThrow(SyntaxError);
	});
});
