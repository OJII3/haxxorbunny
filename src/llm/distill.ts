import { config } from "../config.ts";
import {
	loadDailyMemory,
	loadMemory,
	saveDailyMemory,
	saveMemory,
} from "./memory.ts";
import { triageLlm } from "./triage-client.ts";

interface DistillResult {
	summary: string;
	promote_to_long_term: string[];
	remove_from_long_term: string[];
	reasoning: string;
}

const DISTILL_SYSTEM_PROMPT = `
あなたは Discord bot "haxxorbunny" の記憶蒸留エンジンです。
日次の記憶エントリを受け取り、以下を行ってください:

1. 日次サマリーを1文で生成
2. 長期記憶に昇格すべきエントリを選定
3. 長期記憶から削除すべき古い/不要なエントリを選定

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "summary": "今日のサマリー（1文）",
  "promote_to_long_term": ["長期記憶に追加すべきエントリ"],
  "remove_from_long_term": ["長期記憶から削除すべきエントリ（完全一致）"],
  "reasoning": "判定理由（短く）"
}
`.trim();

export async function distillDailyMemory(dateKey?: string): Promise<void> {
	const key = dateKey ?? new Date().toISOString().slice(0, 10);
	const daily = loadDailyMemory(key);

	if (daily.entries.length === 0) {
		console.log(`[distill] ${key}: エントリなし、スキップ`);
		return;
	}

	const memory = loadMemory();

	const context = `
## 日次記憶 (${key})
${daily.entries.map((e) => `- ${e}`).join("\n")}

## 現在の長期記憶 (${memory.entries.length}件)
${memory.entries.length > 0 ? memory.entries.map((e) => `- ${e}`).join("\n") : "(なし)"}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: DISTILL_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.3,
			max_tokens: 400,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) return;

		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return;

		const result = JSON.parse(jsonMatch[0]) as DistillResult;

		// 長期記憶から削除
		if (result.remove_from_long_term.length > 0) {
			memory.entries = memory.entries.filter(
				(e) => !result.remove_from_long_term.includes(e),
			);
			console.log(
				`[distill] Removed ${result.remove_from_long_term.length} entries from long-term memory`,
			);
		}

		// 長期記憶に昇格
		for (const entry of result.promote_to_long_term) {
			if (!memory.entries.includes(entry)) {
				memory.entries.push(entry);
			}
		}
		if (result.promote_to_long_term.length > 0) {
			console.log(
				`[distill] Promoted ${result.promote_to_long_term.length} entries to long-term memory`,
			);
		}

		// 上限チェック
		if (memory.entries.length > 100) {
			memory.entries = memory.entries.slice(-100);
		}

		saveMemory(memory);

		// 日次ファイルにサマリーを追記
		daily.entries.push(`[蒸留サマリー] ${result.summary}`);
		saveDailyMemory(key, daily);

		console.log(
			`[distill] ${key} | summary: ${result.summary} | reason: ${result.reasoning}`,
		);
	} catch (error) {
		console.error("[distill] Error:", error);
	}
}
