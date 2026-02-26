/** "MM/DD HH:MM" 形式 (JST) — 会話履歴の各メッセージ用 */
export function formatJSTShort(date: Date): string {
	const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
	const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
	const day = String(jst.getUTCDate()).padStart(2, "0");
	const hours = String(jst.getUTCHours()).padStart(2, "0");
	const minutes = String(jst.getUTCMinutes()).padStart(2, "0");
	return `${month}/${day} ${hours}:${minutes}`;
}

/** "YYYY/MM/DD HH:MM" 形式 (JST) — 現在時刻表示用 */
export function formatJSTFull(date: Date): string {
	const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
	const year = jst.getUTCFullYear();
	const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
	const day = String(jst.getUTCDate()).padStart(2, "0");
	const hours = String(jst.getUTCHours()).padStart(2, "0");
	const minutes = String(jst.getUTCMinutes()).padStart(2, "0");
	return `${year}/${month}/${day} ${hours}:${minutes}`;
}
