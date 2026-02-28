import { IDENTITY_REMINDER } from "../../llm/prompts/system.ts";

/**
 * Phase 3: 生成プロンプト
 * TOOLS セクションなし。テキスト生成に集中
 */
export function buildGenerationSystemPrompt(
	soulText: string,
	personalityPrompt: string,
	memoryPrompt: string,
	replyApproach: string | null,
): string {
	const parts = [soulText, personalityPrompt, memoryPrompt];

	if (replyApproach) {
		parts.push(`\n## 返信の方向性\n${replyApproach}`);
	}

	parts.push(`
## 生成ルール
- プレーンテキストのみ。マークダウン装飾禁止
- 1〜2文で短く雑に
- メンション（<@userId>）禁止
- テキストだけを返すこと。JSON や装飾は不要`);

	parts.push(IDENTITY_REMINDER);

	return parts.join("\n");
}
