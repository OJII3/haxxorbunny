import type { Message } from "discord.js";
import { config } from "../config.ts";

interface BufferedGroup {
	messages: Message[];
	timer: Timer;
	hasMention: boolean;
	startedAt: number;
}

type FlushHandler = (messages: Message[], hasMention: boolean) => void;

const buffer = new Map<string, BufferedGroup>();
let flushHandler: FlushHandler | null = null;

function makeKey(message: Message): string {
	return `${message.channelId}:${message.author.id}`;
}

function flush(key: string): void {
	const group = buffer.get(key);
	if (!group) return;

	buffer.delete(key);

	if (flushHandler) {
		flushHandler(group.messages, group.hasMention);
	}
}

export function setFlushHandler(handler: FlushHandler): void {
	flushHandler = handler;
}

export function bufferMessage(message: Message, mentioned: boolean): void {
	const key = makeKey(message);
	const now = Date.now();
	const existing = buffer.get(key);

	if (existing) {
		// タイマーリセット
		clearTimeout(existing.timer);
		existing.messages.push(message);
		if (mentioned) existing.hasMention = true;

		// maxMs 超過で強制フラッシュ
		if (now - existing.startedAt >= config.messageBuffer.maxMs) {
			console.log(
				`[buffer] max wait exceeded for ${key}, force flushing ${existing.messages.length} messages`,
			);
			flush(key);
			return;
		}

		existing.timer = setTimeout(() => flush(key), config.messageBuffer.ms);
		console.log(
			`[buffer] appended to ${key}, total: ${existing.messages.length} messages`,
		);
	} else {
		// 新規グループ
		const timer = setTimeout(() => flush(key), config.messageBuffer.ms);
		buffer.set(key, {
			messages: [message],
			timer,
			hasMention: mentioned,
			startedAt: now,
		});
		console.log(`[buffer] new group for ${key}`);
	}
}

// テスト用ユーティリティ
export function getBufferSize(): number {
	return buffer.size;
}

export function getBufferedCount(channelId: string, userId: string): number {
	const key = `${channelId}:${userId}`;
	return buffer.get(key)?.messages.length ?? 0;
}

export function clearBuffer(): void {
	for (const group of buffer.values()) {
		clearTimeout(group.timer);
	}
	buffer.clear();
}
