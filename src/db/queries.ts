import { and, count, desc, eq, gt, like, type SQL, sql } from "drizzle-orm";
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

export function searchMessages(opts: {
	guildId: string;
	channelId?: string;
	username?: string;
	keyword?: string;
	botOnly?: boolean;
	limit?: number;
}) {
	const limit = Math.min(opts.limit ?? 20, 50);
	const conditions: SQL[] = [eq(messages.guildId, opts.guildId)];
	if (opts.channelId) conditions.push(eq(messages.channelId, opts.channelId));
	if (opts.username) conditions.push(eq(messages.username, opts.username));
	if (opts.keyword)
		conditions.push(like(messages.content, `%${opts.keyword}%`));
	if (opts.botOnly) conditions.push(eq(messages.isBot, true));
	return db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(limit)
		.all()
		.reverse();
}

export function searchBotActions(opts: {
	guildId: string;
	channelId?: string;
	action?: string;
	triggeredBy?: string;
	limit?: number;
}) {
	const limit = Math.min(opts.limit ?? 10, 30);
	const conditions: SQL[] = [eq(botActions.guildId, opts.guildId)];
	if (opts.channelId) conditions.push(eq(botActions.channelId, opts.channelId));
	if (opts.action) conditions.push(eq(botActions.action, opts.action));
	if (opts.triggeredBy)
		conditions.push(eq(botActions.triggeredBy, opts.triggeredBy));
	return db
		.select()
		.from(botActions)
		.where(and(...conditions))
		.orderBy(desc(botActions.createdAt))
		.limit(limit)
		.all()
		.reverse();
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
