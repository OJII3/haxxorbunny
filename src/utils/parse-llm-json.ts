/**
 * LLM レスポンスから JSON をパースする汎用ユーティリティ。
 * マークダウンコードブロックの除去、不完全な JSON の補完を行う。
 */
export function parseLlmJson<T>(raw: string): T | null {
	const cleaned = raw
		.replace(/^```(?:json)?\s*\n?/i, "")
		.replace(/\n?```\s*$/i, "");
	const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]) as T;
		} catch {
			// パース失敗 — 下で補完を試みる
		}
	}

	// 不完全な JSON を補完して再試行（末尾の } が欠けているケース）
	const braceMatch = cleaned.match(/\{[\s\S]*/);
	if (braceMatch) {
		const partial = braceMatch[0];
		const openQuotes = (partial.match(/(?<!\\)"/g) || []).length;
		let repaired = partial;
		if (openQuotes % 2 !== 0) {
			repaired += '"';
		}
		repaired += "}";
		try {
			return JSON.parse(repaired) as T;
		} catch {
			// 補完でも失敗
		}
	}

	return null;
}
