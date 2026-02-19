import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "./index.ts";
import { botActions, messages } from "./schema.ts";

export function saveMessage(data: {
	guildId?: string;
	channelId: string;
	userId: string;
	username: string;
	content: string;
	isBot: boolean;
}) {
	return db
		.insert(messages)
		.values({
			guildId: data.guildId ?? "",
			channelId: data.channelId,
			userId: data.userId,
			username: data.username,
			content: data.content,
			isBot: data.isBot,
			createdAt: new Date(),
		})
		.run();
}

export function getRecentMessages(channelId: string, limit = 20) {
	return db
		.select()
		.from(messages)
		.where(eq(messages.channelId, channelId))
		.orderBy(desc(messages.createdAt))
		.limit(limit)
		.all()
		.reverse();
}

export function saveBotAction(data: {
	guildId?: string;
	action: string;
	channelId?: string | null;
	content?: string | null;
	reasoning?: string | null;
	triggeredBy: string;
}) {
	return db
		.insert(botActions)
		.values({
			guildId: data.guildId ?? "",
			action: data.action,
			channelId: data.channelId,
			content: data.content,
			reasoning: data.reasoning,
			triggeredBy: data.triggeredBy,
			createdAt: new Date(),
		})
		.run();
}

export function getLastBotAction(channelId: string) {
	return (
		db
			.select()
			.from(botActions)
			.where(eq(botActions.channelId, channelId))
			.orderBy(desc(botActions.createdAt))
			.limit(1)
			.all()[0] ?? null
	);
}

export function getActiveChannelIds(guildId?: string, limit = 5): string[] {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const conditions = [gt(messages.createdAt, since)];
	if (guildId) {
		conditions.push(eq(messages.guildId, guildId));
	}
	const rows = db
		.select({ channelId: messages.channelId, cnt: count() })
		.from(messages)
		.where(and(...conditions))
		.groupBy(messages.channelId)
		.orderBy(sql`count(*) desc`)
		.limit(limit)
		.all();
	return rows.map((r) => r.channelId);
}
