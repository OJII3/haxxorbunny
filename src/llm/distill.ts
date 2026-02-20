import { config } from "../config.ts";
import {
	loadDailyMemory,
	loadMemory,
	type MemoryEntry,
	normalizeEntry,
	saveDailyMemory,
	saveMemory,
} from "./memory.ts";
import { triageLlm } from "./triage-client.ts";

interface DistillResult {
	summary: string;
	promote_to_long_term: string[];
	remove_indices: number[];
	reasoning: string;
}

const DISTILL_SYSTEM_PROMPT = `
あなたは "世界の泡の住人" の記憶蒸留エンジンです。
日次の記憶エントリを受け取り、以下を行ってください:

1. 日次サマリーを1文で生成
2. 長期記憶に昇格すべきエントリを選定
3. 長期記憶から削除すべき古い/不要なエントリのインデックス番号を選定

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "summary": "今日のサマリー（1文）",
  "promote_to_long_term": ["長期記憶に追加すべきエントリ"],
  "remove_indices": [0, 3, 5],
  "reasoning": "判定理由（短く）"
}

注意:
- remove_indices は現在の長期記憶のインデックス番号（0始まり）の配列
- 削除は本当に不要なものだけ（古くて意味のないもの）
- 大半の場合、削除は不要
`.trim();

export async function distillDailyMemory(
	guildId: string,
	dateKey?: string,
): Promise<void> {
	const key = dateKey ?? new Date().toISOString().slice(0, 10);
	const daily = loadDailyMemory(guildId, key);

	if (daily.entries.length === 0) {
		console.log(`[distill] ${key}: エントリなし、スキップ`);
		return;
	}

	const memory = loadMemory(guildId);

	const longTermList =
		memory.entries.length > 0
			? memory.entries
					.map((e, i) => {
						const entry = normalizeEntry(e);
						return `[${i}] ${entry.text} (impact=${entry.emotional_impact})`;
					})
					.join("\n")
			: "(なし)";

	const context = `
## 日次記憶 (${key})
${daily.entries.map((e) => `- ${e}`).join("\n")}

## 現在の長期記憶 (${memory.entries.length}件)
${longTermList}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: DISTILL_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.3,
			max_tokens: 2048,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[distill] Empty response");
			return;
		}

		// マークダウンコードブロックを除去してから JSON 部分を抽出
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("[distill] No JSON found in response:", raw);
			return;
		}

		const result = JSON.parse(jsonMatch[0]) as DistillResult;

		// 長期記憶からインデックスで削除（大きい順にソートして削除）
		if (result.remove_indices.length > 0) {
			const validIndices = result.remove_indices
				.filter((i) => i >= 0 && i < memory.entries.length)
				.sort((a, b) => b - a);
			for (const idx of validIndices) {
				memory.entries.splice(idx, 1);
			}
			console.log(
				`[distill] Removed ${validIndices.length} entries from long-term memory`,
			);
		}

		// 長期記憶に昇格 (MemoryEntry 形式で保存)
		for (const entry of result.promote_to_long_term) {
			const existingTexts = memory.entries.map((e) => normalizeEntry(e).text);
			if (!existingTexts.includes(entry)) {
				const memoryEntry: MemoryEntry = {
					text: entry,
					emotional_impact: 3, // 蒸留で昇格 = やや印象的
					created_at: new Date().toISOString(),
				};
				memory.entries.push(memoryEntry);
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

		saveMemory(guildId, memory);

		// 日次ファイルにサマリーを追記
		daily.entries.push(`[蒸留サマリー] ${result.summary}`);
		saveDailyMemory(guildId, key, daily);

		console.log(
			`[distill] ${key} | summary: ${result.summary} | reason: ${result.reasoning}`,
		);
	} catch (error) {
		console.error("[distill] Error:", error);
	}
}
