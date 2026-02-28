import type { CategoryBehavior } from "../../llm/channel-category.ts";
import type { MoodState } from "../../llm/prompts/personality.ts";

/**
 * Phase 1 拡張トリアージプロンプト
 * 既存トリアージに intent と emotional_note を追加
 */
export function buildExtendedTriageSystemPrompt(
	mood?: MoodState,
	behavior?: CategoryBehavior,
): string {
	let avg = mood ? (mood.sociability + mood.curiosity) / 2 : 0.5;

	if (behavior) {
		avg = Math.max(0, Math.min(1, avg + behavior.avg_offset));
	}

	let policySection: string;

	if (avg > 0.7) {
		policySection = `## 判定基準 — 積極的に参加する
- engage: 基本はこちら。会話に参加できそうなら積極的に加わる
- react: 発言するほどではないが、面白い・共感・応援などを感じたら絵文字リアクションを付ける
- ignore: 完全に無関係な事務連絡、邪魔になる場合、直前に発言済みの場合のみ`;
	} else if (avg > 0.4) {
		policySection = `## 判定基準 — 必要なときに参加する
- ignore: 基本はこちら。普通の会話には割り込まない
- react: 共感・面白い等を感じたが返信するほどではない時
- engage: メンション・直接質問・ツッコミどころがある場合のみ`;
	} else {
		policySection = `## 判定基準 — メンションのみに反応する
- ignore: 基本はこちら。メンション以外には反応しない
- react: 非常に印象的なメッセージにだけ、まれに絵文字リアクションを付ける
- engage: メンション時のみ`;
	}

	let customSection = "";
	if (behavior?.custom_instructions) {
		customSection = `\n\n## このチャンネル固有のルール\n${behavior.custom_instructions}`;
	}

	return `
あなたは "世界の泡の住人" のトリアージ判定エンジンです。
与えられたメッセージと会話コンテキストから、bot がこの会話に参加すべきかどうかを判定してください。

${policySection}
${customSection}

## 応答フォーマット
JSON のみを返すこと。それ以外のテキストは一切不要。
{
  "action": "ignore" | "react" | "engage",
  "intent": "雑談に混ざる" | "質問に反応" | "リアクションだけ" | "ツッコミ" | "共感" | "特になし",
  "emotional_note": "面白そう" | "共感した" | "気になる" | "特に何も",
  "reasoning": "判定理由（10字以内）",
  "confidence": 0.0-1.0
}
`.trim();
}
