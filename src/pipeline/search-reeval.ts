import { config } from "../config.ts";
import { triageLlm } from "../llm/triage-client.ts";
import type { SearchReEvalAction, SearchReEvalResult } from "./types.ts";

const SEARCH_RESULT_LIMIT = 1000;

const REEVAL_SYSTEM_PROMPT = `あなたはDiscord botの内部判断モジュールです。
検索結果がユーザーの質問/会話に対して有用かを判定してください。

## 判定基準
- proceed: 検索結果がそのまま使える。元の計画通りに返信。
- adjust: 検索結果から新しい角度が見えた。reply_approachを調整して返信。adjusted_approachに新しい方向性を記入。
- drop_search: 検索結果が無関係。検索結果を捨てて、検索なしで返信。
- give_up: 答えようがない。雑に流す。

## キャラ設定
このbotは「頭を使わない」「謝らない」「雑に流す」キャラ。give_upは恥ずかしいことではない。

## 出力形式（JSON のみ）
{"action":"proceed"|"adjust"|"drop_search"|"give_up","adjusted_approach":"adjustの場合のみ記入、それ以外はnull","reasoning":"判断理由（短く）"}`;

/**
 * 検索結果の再評価
 * 検索実行後・生成前に、検索結果が有用かを軽量LLMで判定する
 */
export async function reEvalSearch(
	replyApproach: string | null,
	searchQuery: string | null,
	searchResults: string | null,
	userMessage: string,
): Promise<SearchReEvalResult> {
	// 検索失敗の場合は LLM を呼ばずに即 give_up
	if (searchResults === null) {
		console.log(
			"[pipeline/search-reeval] Search failed, giving up without LLM call",
		);
		return {
			action: "give_up",
			adjusted_approach: null,
			reasoning: "検索失敗",
		};
	}

	const truncatedResults = searchResults.slice(0, SEARCH_RESULT_LIMIT);

	const userPrompt = `## 元の返信方針
${replyApproach ?? "（なし）"}

## 検索クエリ
${searchQuery ?? "（なし）"}

## 検索結果（抜粋）
${truncatedResults}

## ユーザーメッセージ
${userMessage}`;

	try {
		const response = await triageLlm.chat.completions.create({
			model: config.triage.model,
			messages: [
				{ role: "system", content: REEVAL_SYSTEM_PROMPT },
				{ role: "user", content: userPrompt },
			],
			temperature: 0.3,
			max_tokens: 256,
		});

		const raw = response.choices[0]?.message?.content?.trim();
		if (!raw) {
			console.warn(
				"[pipeline/search-reeval] Empty response, falling back to proceed",
			);
			return {
				action: "proceed",
				adjusted_approach: null,
				reasoning: "再評価応答なし、フォールバック",
			};
		}

		const parsed = parseReEvalResponse(raw);
		console.log(
			`[pipeline/search-reeval] action=${parsed.action}, reasoning=${parsed.reasoning}`,
		);
		return parsed;
	} catch (error) {
		console.error("[pipeline/search-reeval] Error:", error);
		return {
			action: "proceed",
			adjusted_approach: null,
			reasoning: "再評価エラー、フォールバック",
		};
	}
}

/** LLM 応答から SearchReEvalResult をパースする */
function parseReEvalResponse(raw: string): SearchReEvalResult {
	const jsonMatch = raw.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return {
			action: "proceed",
			adjusted_approach: null,
			reasoning: "JSONパース失敗、フォールバック",
		};
	}

	try {
		const obj = JSON.parse(jsonMatch[0]);
		const validActions: SearchReEvalAction[] = [
			"proceed",
			"adjust",
			"drop_search",
			"give_up",
		];
		const action: SearchReEvalAction = validActions.includes(obj.action)
			? obj.action
			: "proceed";

		return {
			action,
			adjusted_approach:
				action === "adjust" ? (obj.adjusted_approach ?? null) : null,
			reasoning: obj.reasoning ?? "",
		};
	} catch {
		return {
			action: "proceed",
			adjusted_approach: null,
			reasoning: "JSONパース失敗、フォールバック",
		};
	}
}
