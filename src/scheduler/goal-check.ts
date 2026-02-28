import { client } from "../client.ts";
import { config } from "../config.ts";
import {
	type Goal,
	getActiveGoals,
	loadGoals,
	saveGoals,
} from "../llm/goals.ts";
import { appendThought } from "../llm/thought-buffer.ts";
import { triageLlm } from "../llm/triage-client.ts";

interface GoalAnalysis {
	goal_id: string;
	content: string;
	intensity: number;
	skip: boolean;
}

interface GoalCheckResult {
	analyses: GoalAnalysis[];
	reasoning: string;
}

const GOAL_CHECK_SYSTEM_PROMPT = `
あなたは "世界の泡の住人" のゴール管理エンジンです。
アクティブなゴールの状態を分析し、各ゴールについて「思考の断片」を生成してください。

## 応答フォーマット
必ず以下の JSON のみを返してください:
{
  "analyses": [
    {
      "goal_id": "goal_xxx",
      "content": "最近進んでないな...",
      "intensity": 0.6,
      "skip": false
    }
  ],
  "reasoning": "判定理由（短く）"
}

## 各フィールドの説明
- goal_id: 入力で与えられたゴールの ID
- content: そのゴールについて感じたこと・気づき（短い自然言語、キャラクターの独り言風）
- intensity: どれくらい気になったか（0.0〜1.0）
  - 0.0〜0.3: あまり気にしてない
  - 0.4〜0.6: ちょっと気になる
  - 0.7〜1.0: かなり気になってる、何かしたい
- skip: このゴールについて特に思うことがなければ true

## 注意
- 全ゴールを skip しても OK。無理に何か生成しなくていい
- 長期間更新がないゴールには intensity を高めに設定する
- 最近進捗があったゴールは低めの intensity でOK
- content はキャラクターの独り言風に。システム的な報告文ではなく感情を込めて
- skip: true のゴールは content と intensity は無視される
`.trim();

function buildGoalContext(goals: Goal[]): string {
	const now = new Date();
	const lines = goals.map((goal) => {
		const updatedAt = new Date(goal.updated_at);
		const daysSinceUpdate = Math.floor(
			(now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24),
		);
		const lastNote =
			goal.progress_notes.length > 0
				? goal.progress_notes[goal.progress_notes.length - 1]
				: "(進捗なし)";
		return `- ID: ${goal.id} | タイトル: ${goal.title} | 説明: ${goal.description} | 優先度: ${goal.priority} | 最終更新: ${daysSinceUpdate}日前 | 最新進捗: ${lastNote}`;
	});

	return `## アクティブなゴール一覧 (${goals.length}件)\n${lines.join("\n")}`;
}

export async function checkGoals(): Promise<void> {
	for (const guild of client.guilds.cache.values()) {
		const activeGoals = getActiveGoals(guild.id);
		if (activeGoals.length === 0) {
			console.log(`[goal-check] ${guild.name}: No active goals, skipping`);
			continue;
		}

		const context = buildGoalContext(activeGoals);

		try {
			const response = await triageLlm.chat.completions.create({
				model: config.triage.model,
				messages: [
					{ role: "system", content: GOAL_CHECK_SYSTEM_PROMPT },
					{ role: "user", content: context },
				],
				temperature: 0.3,
				max_tokens: 1024,
			});

			const raw = response.choices[0]?.message?.content?.trim();
			if (!raw) {
				console.warn(`[goal-check] ${guild.name}: Empty response`);
				continue;
			}

			const cleaned = raw
				.replace(/^```(?:json)?\s*\n?/i, "")
				.replace(/\n?```\s*$/i, "");
			const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				console.warn(
					`[goal-check] ${guild.name}: No JSON found in response:`,
					raw,
				);
				continue;
			}

			let result: GoalCheckResult;
			try {
				result = JSON.parse(jsonMatch[0]) as GoalCheckResult;
			} catch {
				console.warn(
					`[goal-check] ${guild.name}: Failed to parse JSON:`,
					jsonMatch[0].slice(0, 200),
				);
				continue;
			}

			let thoughtCount = 0;
			const goalIdSet = new Set(activeGoals.map((g) => g.id));

			for (const analysis of result.analyses) {
				if (analysis.skip) continue;
				if (!analysis.content) continue;

				const relatedGoalId = goalIdSet.has(analysis.goal_id)
					? analysis.goal_id
					: undefined;

				appendThought(
					analysis.content,
					"goal_related",
					"goal_check",
					analysis.intensity,
					relatedGoalId,
				);
				thoughtCount++;
			}

			// last_review を更新
			const goalsData = loadGoals(guild.id);
			goalsData.last_review = new Date().toISOString();
			saveGoals(guild.id, goalsData);

			console.log(
				`[goal-check] ${guild.name}: ${thoughtCount} thoughts added | reason: ${result.reasoning}`,
			);
		} catch (error) {
			console.error(`[goal-check] ${guild.name}: Error:`, error);
		}
	}
}
