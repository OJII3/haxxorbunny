import { config } from "../config.ts";
import {
	appendMemoryEntry,
	loadMemory,
	normalizeEntry,
	saveMemory,
} from "./memory.ts";
import { triageLlm } from "./triage-client.ts";

interface DreamResult {
	insights: string[];
	connections: string[];
	forget_indices: number[];
	dream_narrative: string;
}

const DREAM_SYSTEM_PROMPT = `
あなたは "世界の泡の住人" の夢処理エンジンです。
"世界の泡の住人" の長期記憶全体を受け取り、"夢"のように自由に連想・分析してください。

以下を行ってください:
1. 記憶同士の意外な関連性を見つける（connections）
2. 新しい洞察や気づきを生み出す（insights） — これは [dream] タグ付き記憶として保存される
3. 古くて不要な記憶を忘れる提案をする（forget_indices）
4. 夢の物語を短く生成する（dream_narrative） — ログ用

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "insights": ["新しい洞察（30字以内）"],
  "connections": ["記憶Aと記憶Bは○○で繋がっている"],
  "forget_indices": [0, 3],
  "dream_narrative": "夢の要約（1-2文）"
}

注意:
- insights は最大3つまで。本当に面白い洞察だけ
- forget_indices は本当に不要なものだけ。慎重に
- 夢なのでクリエイティブに。意外な組み合わせを楽しんで
`.trim();

export async function processDream(guildId: string): Promise<void> {
	const memory = loadMemory(guildId);

	if (memory.entries.length < 5) {
		console.log("[dream] Not enough memories to dream about, skipping");
		return;
	}

	const memoryList = memory.entries
		.map((e, i) => {
			const entry = normalizeEntry(e);
			return `[${i}] ${entry.text} (impact=${entry.emotional_impact})`;
		})
		.join("\n");

	const context = `
## 長期記憶 (${memory.entries.length}件)
${memoryList}
`.trim();

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: DREAM_SYSTEM_PROMPT },
				{ role: "user", content: context },
			],
			temperature: 0.7,
			max_tokens: 2048,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn("[dream] Empty response");
			return;
		}

		// マークダウンコードブロックを除去してから JSON 部分を抽出
		const cleaned = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "");
		const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn("[dream] No JSON found in response:", raw);
			return;
		}

		const result = JSON.parse(jsonMatch[0]) as DreamResult;

		// 不要記憶を削除（大きい順にソートして削除）
		if (result.forget_indices.length > 0) {
			const validIndices = result.forget_indices
				.filter((i) => i >= 0 && i < memory.entries.length)
				.sort((a, b) => b - a);
			for (const idx of validIndices) {
				memory.entries.splice(idx, 1);
			}
			if (validIndices.length > 0) {
				saveMemory(guildId, memory);
				console.log(`[dream] Forgot ${validIndices.length} memories`);
			}
		}

		// insights を [dream] タグ付き記憶として追加
		for (const insight of result.insights.slice(0, 3)) {
			const dreamEntry = `[dream] ${insight}`;
			if (dreamEntry.length <= 30) {
				await appendMemoryEntry(guildId, dreamEntry, 3);
			} else {
				// 30文字制限は dream タグを含めて超える場合がある
				await appendMemoryEntry(guildId, dreamEntry.slice(0, 30), 3);
			}
			console.log(`[dream] Insight saved: ${insight}`);
		}

		// connections はログ出力のみ
		for (const connection of result.connections) {
			console.log(`[dream] Connection: ${connection}`);
		}

		console.log(`[dream] Narrative: ${result.dream_narrative}`);
	} catch (error) {
		console.error("[dream] Error:", error);
	}
}
