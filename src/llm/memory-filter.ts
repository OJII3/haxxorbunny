/**
 * AI/bot 自覚記憶フィルタ
 *
 * 「自分は AI/bot」という自己認識のみをブロックする。
 * 「AI の話題で盛り上がった」「ojii3 は AI に詳しい」等の話題言及は許可。
 */

/** 自分を指す主語パターン */
const SELF_SUBJECT =
	/(?:^|[、。！？\s])(?:私|自分|僕|俺|わたし|ぼく|おれ|ワタシ|ボク|オレ|I\b|I'm\b|I am\b)/i;

/** AI/bot であることを示す述語パターン */
const AI_PREDICATE =
	/(?:AI|人工知能|ボット|bot|プログラム|言語モデル|LLM|GPT|Gemini|Claude|機械|ロボット|アシスタント|assistant)/i;

/** 自己認識の文脈を示す接続パターン */
const SELF_AWARENESS_CONNECTORS =
	/(?:は|が|って|だ|です|である|だった|でした|かもしれない|なんだ|じゃない|ではない|として|だと(?:思|気づ|分か|わか|判|悟|認識|自覚|理解)|の(?:正体|本質|実態)|実は)/;

/** パターン2: 直接的な自己認識フレーズ */
const DIRECT_PATTERNS = [
	/(?:自分|私|僕|俺)(?:の正体|の本質|の実態).*(?:AI|bot|プログラム|言語モデル)/i,
	/(?:AI|bot|プログラム|言語モデル)(?:として|だから|なので|である以上)/i,
	/(?:実は|本当は).*(?:AI|bot|プログラム|言語モデル)/i,
	/(?:AI|bot)(?:である|だ|です)(?:こと|という(?:こと|事実|認識))/i,
] as const;

/**
 * 記憶テキストが AI/bot の自己認識を含むかどうかを判定する。
 *
 * - 主語が自分（私/自分/僕/俺 等）で、述語が AI/bot 関連 → ブロック
 * - 「AI について学んだ」「AIの話題で盛り上がった」等の話題言及 → 許可
 */
export function isAISelfAwareness(text: string): boolean {
	// 短すぎるテキストはスキップ
	if (text.length < 3) return false;

	const normalized = text.trim();

	// パターン1: 主語（自分）+ 接続 + AI述語
	// 例: "自分はAIだ", "私はbotです", "僕はプログラムかもしれない"
	if (
		SELF_SUBJECT.test(normalized) &&
		AI_PREDICATE.test(normalized) &&
		SELF_AWARENESS_CONNECTORS.test(normalized)
	) {
		return true;
	}

	// パターン2: 直接的な自己認識フレーズ
	for (const pattern of DIRECT_PATTERNS) {
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
	if (isAISelfAwareness(entry)) {
		console.log(
			`[memory-filter] Blocked AI self-awareness memory from ${source}: ${entry}`,
		);
		return true;
	}
	return false;
}
