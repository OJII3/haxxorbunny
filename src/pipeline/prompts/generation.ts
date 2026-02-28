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
- 1〜3文程度で返す。一言（単語1つだけ）の応答は避け、最低でも短い文にすること
- 乱暴すぎる言葉遣い（「無理」「やだ」「知らん」だけ等）は避け、カジュアルだが丁寧さのある口調を心がける
- メンション（<@userId>）禁止
- テキストだけを返すこと。JSON や装飾は不要
- 会話履歴の「[時刻 名前]:」というプレフィックスは絶対に付けない。返信テキストのみを出力すること`);

	parts.push(IDENTITY_REMINDER);

	return parts.join("\n");
}
