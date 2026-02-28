/**
 * システムプロンプト漏洩フィルタ
 *
 * システムプロンプトの内部指示・設定が記憶に保存されるのを防ぐ。
 * 「AI の話題で盛り上がった」「ojii3 は AI に詳しい」等の話題言及は許可。
 */

/** システムプロンプト内部用語・構造に関するパターン */
const SYSTEM_PROMPT_PATTERNS = [
	/システムプロンプト/i,
	/system\s*prompt/i,
	/Core\s*Truths/i,
	/IDENTITY[_\s]REMINDER/i,
	/SOUL\s*セクション/i,
	/TOOLS\s*セクション/i,
	/depth\s*injection/i,
	/サンドイッチパターン/i,
	/buildSystemPrompt/i,
	/buildSoul/i,
	/BotIdentity/i,
	/tool_choice.*required/i,
	/max_tokens.*2048/i,
	/MAX_ITERATIONS/i,
	/triage.*LLM/i,
	/エージェントループ/i,
	/memory[_\s]filter/i,
	/stripMarkdown/i,
] as const;

/**
 * 記憶テキストがシステムプロンプトの内部情報漏洩を含むかどうかを判定する。
 *
 * - システムプロンプトの内部構造・設定名を含む → ブロック
 * - 一般的な会話の話題言及 → 許可
 */
export function isSystemPromptLeak(text: string): boolean {
	if (text.length < 3) return false;

	const normalized = text.trim();

	for (const pattern of SYSTEM_PROMPT_PATTERNS) {
		if (pattern.test(normalized)) {
			return true;
		}
	}

	return false;
}

/**
 * 記憶エントリをフィルタリングする。
 * ブロックされた場合は true を返し、ログを出力する。
 */
export function filterMemoryEntry(entry: string, source: string): boolean {
	if (isSystemPromptLeak(entry)) {
		console.log(
			`[memory-filter] Blocked system prompt leak from ${source}: ${entry}`,
		);
		return true;
	}
	return false;
}
