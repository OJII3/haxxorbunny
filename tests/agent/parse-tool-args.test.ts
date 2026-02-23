import { describe, expect, test } from "bun:test";
import {
	parseAllJsonObjects,
	parseToolArguments,
} from "../../src/agent/loop.ts";
import { inferToolNameFromArgs } from "../../src/agent/tools/index.ts";

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

	test("連結 JSON の間にホワイトスペースがある場合も先頭のみ抽出する", () => {
		const raw = '{"a":1} {"b":2}';
		const result = parseToolArguments(raw);
		expect(result).toEqual({ a: 1 });
	});

	test("Unicode エスケープを含む JSON を正しく処理する", () => {
		const result = parseToolArguments('{"key":"\\u0041"}');
		expect(result).toEqual({ key: "A" });
	});
});

describe("parseAllJsonObjects", () => {
	test("正常な単一 JSON を 1 要素の配列で返す", () => {
		const result = parseAllJsonObjects('{"entry":"hello"}');
		expect(result).toEqual([{ entry: "hello" }]);
	});

	test("連結された 2 つの JSON を全て返す", () => {
		const raw =
			'{"entry":"memory","emotional_impact":5}{"title":"goal","description":"desc"}';
		const result = parseAllJsonObjects(raw);
		expect(result).toEqual([
			{ entry: "memory", emotional_impact: 5 },
			{ title: "goal", description: "desc" },
		]);
	});

	test("連結された 3 つの JSON を全て返す", () => {
		const raw =
			'{"entry":"a","emotional_impact":5}{"title":"b","description":"c"}{"url":"https://example.com"}';
		const result = parseAllJsonObjects(raw);
		expect(result).toEqual([
			{ entry: "a", emotional_impact: 5 },
			{ title: "b", description: "c" },
			{ url: "https://example.com" },
		]);
	});

	test("文字列内のブレースを正しく処理する", () => {
		const raw = '{"content":"hello { world } test"}{"extra":"value"}';
		const result = parseAllJsonObjects(raw);
		expect(result).toEqual([
			{ content: "hello { world } test" },
			{ extra: "value" },
		]);
	});

	test("ホワイトスペース区切りの連結 JSON を処理する", () => {
		const raw = '{"a":1} {"b":2}';
		const result = parseAllJsonObjects(raw);
		expect(result).toEqual([{ a: 1 }, { b: 2 }]);
	});

	test("空オブジェクトを含む連結 JSON を処理する", () => {
		const raw = '{"entry":"hello"}{}';
		const result = parseAllJsonObjects(raw);
		expect(result).toEqual([{ entry: "hello" }, {}]);
	});

	test("不正な文字列で空配列を返す", () => {
		expect(parseAllJsonObjects("not json")).toEqual([]);
	});

	test("空文字列で空配列を返す", () => {
		expect(parseAllJsonObjects("")).toEqual([]);
	});

	test("ログで観測された実パターンを処理する", () => {
		const raw = '{"emoji":"👀"}{"content":"ぼくはhaxxorbunny。"}';
		const result = parseAllJsonObjects(raw);
		expect(result).toEqual([
			{ emoji: "👀" },
			{ content: "ぼくはhaxxorbunny。" },
		]);
	});
});

describe("inferToolNameFromArgs", () => {
	test("entry → save_memory を推定する", () => {
		const result = inferToolNameFromArgs({
			entry: "hello",
			emotional_impact: 3,
		});
		expect(result).not.toBeNull();
		expect(result?.name).toBe("save_memory");
		expect(result?.score).toBe(1.0);
	});

	test("emoji → add_reaction を推定する", () => {
		const result = inferToolNameFromArgs({ emoji: "👀" });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("add_reaction");
	});

	test("query → web_search を推定する", () => {
		const result = inferToolNameFromArgs({ query: "test" });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("web_search");
	});

	test("url → fetch_url を推定する", () => {
		const result = inferToolNameFromArgs({ url: "https://example.com" });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("fetch_url");
	});

	test("title + description → set_goal を推定する", () => {
		const result = inferToolNameFromArgs({
			title: "goal",
			description: "desc",
		});
		expect(result).not.toBeNull();
		expect(result?.name).toBe("set_goal");
	});

	test("username + note → save_user_note を推定する", () => {
		const result = inferToolNameFromArgs({ username: "user", note: "note" });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("save_user_note");
	});

	test("content → send_message を推定する (reply_to_message より優先)", () => {
		const result = inferToolNameFromArgs({ content: "hello" });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("send_message");
	});

	test("content + channel_id → send_message を推定する (2キーマッチ)", () => {
		const result = inferToolNameFromArgs({
			content: "hello",
			channel_id: "123",
		});
		expect(result).not.toBeNull();
		expect(result?.name).toBe("send_message");
		expect(result?.score).toBe(1.0);
	});

	test("message_id → message_id を持つツールの1つを推定する", () => {
		const result = inferToolNameFromArgs({ message_id: "123" });
		expect(result).not.toBeNull();
		// message_id を持つツールは複数あるが定義順で最初のものが選ばれる
		const validTools = [
			"edit_message",
			"delete_message",
			"pin_message",
			"unpin_message",
		];
		expect(validTools).toContain(result?.name ?? "");
	});

	test("空オブジェクト → null を返す", () => {
		expect(inferToolNameFromArgs({})).toBeNull();
	});

	test("不明なキーのみ → null を返す", () => {
		expect(inferToolNameFromArgs({ unknown_key: "value" })).toBeNull();
	});

	test("半数以上不明キー → null を返す (閾値 0.5)", () => {
		// content は既知だが foo, bar は不明 → score = 1/3 ≈ 0.33 < 0.5
		expect(
			inferToolNameFromArgs({ content: "hello", foo: "x", bar: "y" }),
		).toBeNull();
	});

	test("スコアが 0.5 以上なら推定する", () => {
		// content は既知、foo は不明 → score = 1/2 = 0.5
		const result = inferToolNameFromArgs({ content: "hello", foo: "x" });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("send_message");
		expect(result?.score).toBe(0.5);
	});
});
