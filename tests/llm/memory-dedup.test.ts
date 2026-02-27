import { describe, expect, test } from "bun:test";
import {
	findDuplicateIndex,
	type MemoryEntry,
	normalizeTextForComparison,
} from "../../src/llm/memory.ts";

describe("normalizeTextForComparison", () => {
	test("句読点・記号が除去されること", () => {
		expect(normalizeTextForComparison("こんにちは、世界！")).toBe(
			"こんにちは世界",
		);
		expect(normalizeTextForComparison("テスト。これはテスト。")).toBe(
			"テストこれはテスト",
		);
		expect(normalizeTextForComparison("a...b!!!c???")).toBe("abc");
		expect(normalizeTextForComparison("「括弧」（丸括弧）【角括弧】")).toBe(
			"括弧丸括弧角括弧",
		);
		expect(normalizeTextForComparison("コロン：セミコロン；")).toBe(
			"コロンセミコロン",
		);
		expect(normalizeTextForComparison("ダッシュ-エムダッシュ\u2014")).toBe(
			"ダッシュエムダッシュ",
		);
	});

	test("スペース・全角スペースが除去されること", () => {
		expect(normalizeTextForComparison("hello world")).toBe("helloworld");
		expect(normalizeTextForComparison("こんにちは\u3000世界")).toBe(
			"こんにちは世界",
		);
		expect(normalizeTextForComparison("  multiple   spaces  ")).toBe(
			"multiplespaces",
		);
		expect(normalizeTextForComparison("\t\n\r")).toBe("");
	});

	test("大文字が小文字に変換されること", () => {
		expect(normalizeTextForComparison("Hello World")).toBe("helloworld");
		expect(normalizeTextForComparison("ABC")).toBe("abc");
		expect(normalizeTextForComparison("TypeScript")).toBe("typescript");
	});

	test("日本語テキストの正規化", () => {
		expect(normalizeTextForComparison("今日は良い天気ですね！")).toBe(
			"今日は良い天気ですね",
		);
		expect(normalizeTextForComparison("プログラミング・勉強・読書が好き")).toBe(
			"プログラミング勉強読書が好き",
		);
		expect(normalizeTextForComparison("テスト（test）")).toBe("テストtest");
	});

	test("空文字列はそのまま返す", () => {
		expect(normalizeTextForComparison("")).toBe("");
	});

	test("記号のみの文字列は空文字列になる", () => {
		expect(normalizeTextForComparison("...!!!???")).toBe("");
		expect(normalizeTextForComparison("　 \t")).toBe("");
	});
});

describe("findDuplicateIndex", () => {
	test("完全一致（正規化後）で重複検出", () => {
		const entries = ["今日は良い天気だった"];
		// 句読点を追加しても正規化後は同じ
		expect(findDuplicateIndex(entries, "今日は良い天気だった")).toBe(0);
		expect(findDuplicateIndex(entries, "今日は、良い天気だった！")).toBe(0);
	});

	test("大文字小文字を無視して完全一致", () => {
		const entries = ["Hello World"];
		expect(findDuplicateIndex(entries, "hello world")).toBe(0);
		expect(findDuplicateIndex(entries, "HELLO WORLD")).toBe(0);
	});

	test("包含関係で重複検出", () => {
		const entries = ["プログラミングが好きだ"];
		// 既存が新しいテキストに含まれる
		expect(
			findDuplicateIndex(entries, "プログラミングが好きだと思っている"),
		).toBe(0);
	});

	test("逆方向の包含関係でも重複検出", () => {
		const entries = ["プログラミングが好きだと思っている"];
		// 新しいテキストが既存に含まれる
		expect(findDuplicateIndex(entries, "プログラミングが好きだ")).toBe(0);
	});

	test("先頭N文字一致で重複検出", () => {
		// DEDUP_PREFIX_LENGTH = 15 なので、正規化後に先頭15文字が一致すれば重複
		const entries = ["あいうえおかきくけこさしすせそたちつてと"];
		// 先頭15文字は同じだが後半が異なる
		expect(
			findDuplicateIndex(entries, "あいうえおかきくけこさしすせそなにぬねの"),
		).toBe(0);
	});

	test("先頭N文字が一致しない場合は重複なし（長さが十分でも）", () => {
		const entries = ["あいうえおかきくけこさしすせそたちつてと"];
		// 先頭が異なる
		expect(
			findDuplicateIndex(entries, "かきくけこさしすせそたちつてとなにぬねの"),
		).toBe(-1);
	});

	test("空文字列では重複なし", () => {
		const entries = ["テスト記憶"];
		expect(findDuplicateIndex(entries, "")).toBe(-1);
	});

	test("記号のみのテキスト（正規化後に空文字列）では重複なし", () => {
		const entries = ["テスト記憶"];
		expect(findDuplicateIndex(entries, "...!!!")).toBe(-1);
	});

	test("重複がない場合は -1 を返す", () => {
		const entries = ["今日は良い天気だった", "猫が好き"];
		expect(findDuplicateIndex(entries, "明日は雨かもしれない")).toBe(-1);
	});

	test("空のエントリリストでは -1 を返す", () => {
		expect(findDuplicateIndex([], "テスト")).toBe(-1);
	});

	test("MemoryEntry オブジェクトでも動作すること", () => {
		const entries: MemoryEntry[] = [
			{
				text: "TypeScriptが楽しい",
				emotional_impact: 3,
				created_at: "2025-01-01T00:00:00.000Z",
			},
			{
				text: "Bunのテストランナーは高速",
				emotional_impact: 4,
				created_at: "2025-01-02T00:00:00.000Z",
			},
		];
		expect(findDuplicateIndex(entries, "TypeScriptが楽しい")).toBe(0);
		expect(findDuplicateIndex(entries, "Bunのテストランナーは高速")).toBe(1);
		expect(findDuplicateIndex(entries, "全く関係ない記憶")).toBe(-1);
	});

	test("string と MemoryEntry が混在するリストでも動作すること", () => {
		const entries: (string | MemoryEntry)[] = [
			"レガシー文字列記憶",
			{
				text: "新しい形式の記憶",
				emotional_impact: 2,
				created_at: "2025-01-01T00:00:00.000Z",
			},
		];
		expect(findDuplicateIndex(entries, "レガシー文字列記憶")).toBe(0);
		expect(findDuplicateIndex(entries, "新しい形式の記憶")).toBe(1);
	});

	test("短い文字列（DEDUP_MIN_CONTAINMENT_LENGTH 未満）では包含関係チェックがスキップされること", () => {
		// DEDUP_MIN_CONTAINMENT_LENGTH = 5
		// 正規化後に4文字の短いテキスト → 包含チェックはスキップされるはず
		const entries = ["あいうえおかきくけこさしすせそ"];
		// "あいうえ" は正規化後4文字。既存テキストに含まれるが、短い側が5文字未満なのでスキップ
		expect(findDuplicateIndex(entries, "あいうえ")).toBe(-1);
	});

	test("短い文字列（DEDUP_MIN_CONTAINMENT_LENGTH ちょうど）では包含関係チェックが行われること", () => {
		// 正規化後にちょうど5文字 → 包含チェックが行われる
		const entries = ["あいうえおかきくけこ"];
		// "あいうえお" は正規化後5文字。既存テキストに含まれるので重複検出
		expect(findDuplicateIndex(entries, "あいうえお")).toBe(0);
	});

	test("先頭N文字チェックは両方がN文字以上の場合のみ行われること", () => {
		// DEDUP_PREFIX_LENGTH = 15
		// 片方が15文字未満の場合、先頭N文字チェックはスキップ
		const entries = ["あいうえおかきくけこさし"]; // 正規化後12文字
		// 先頭が同じだが既存テキストが15文字未満なので先頭チェックはスキップ
		// 包含チェックの方で引っかかる可能性があるので、包含関係にないケースで確認
		const newText = "あいうえおかきくけこさしXYZ"; // 先頭12文字は同じだが全体は異なる
		// 既存が12文字で新しいテキストが15文字 → 先頭N文字チェックは既存が15文字未満なのでスキップ
		// ただし既存が新しいテキストに含まれるので包含チェックで引っかかる
		expect(findDuplicateIndex(entries, newText)).toBe(0);
	});

	test("複数エントリがある場合、最初に見つかったインデックスを返す", () => {
		const entries = [
			"最初の記憶エントリ",
			"二番目の記憶エントリ",
			"最初の記憶エントリの詳細版",
		];
		// "最初の記憶エントリ" はインデックス0と包含関係にある
		expect(findDuplicateIndex(entries, "最初の記憶エントリ")).toBe(0);
	});

	test("既存エントリに空文字列（正規化後）がある場合はスキップされる", () => {
		const entries = ["...", "実際の記憶"];
		// "..." は正規化後に空文字列になるのでスキップ
		expect(findDuplicateIndex(entries, "実際の記憶")).toBe(1);
	});
});
