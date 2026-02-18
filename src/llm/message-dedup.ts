/**
 * メッセージ重複抑制モジュール
 * cron による自主発言が同じ内容を繰り返すのを防ぐ
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const PREFIX_LENGTH = 50;

interface CacheEntry {
	hash: string;
	expiresAt: number;
}

const recentMessages: CacheEntry[] = [];

function computeHash(text: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(text.trim().toLowerCase());
	return hasher.digest("hex");
}

function cleanExpired(): void {
	const now = Date.now();
	let i = 0;
	while (i < recentMessages.length) {
		if (recentMessages[i].expiresAt < now) {
			recentMessages.splice(i, 1);
		} else {
			i++;
		}
	}
}

/**
 * メッセージが最近送信済みかどうかを判定する
 * 完全一致ハッシュ + 冒頭50文字のプレフィックスハッシュの両方をチェック
 */
export function isDuplicate(content: string): boolean {
	cleanExpired();

	const fullHash = computeHash(content);
	const prefixHash = computeHash(content.slice(0, PREFIX_LENGTH));

	return recentMessages.some(
		(entry) => entry.hash === fullHash || entry.hash === prefixHash,
	);
}

/**
 * メッセージをキャッシュに記録する
 */
export function recordMessage(content: string): void {
	cleanExpired();

	const now = Date.now();
	const expiresAt = now + CACHE_TTL_MS;

	recentMessages.push({ hash: computeHash(content), expiresAt });
	recentMessages.push({
		hash: computeHash(content.slice(0, PREFIX_LENGTH)),
		expiresAt,
	});
}
