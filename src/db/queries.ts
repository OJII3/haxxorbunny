import { desc, eq } from "drizzle-orm";
import { db } from "./index.ts";
import { botActions, messages } from "./schema.ts";

export function saveMessage(data: {
	channelId: string;
	userId: string;
	username: string;
	content: string;
	isBot: boolean;
}) {
	return db
		.insert(messages)
		.values({ ...data, createdAt: new Date() })
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
	action: string;
	channelId?: string | null;
	content?: string | null;
	reasoning?: string | null;
	triggeredBy: string;
}) {
	return db
		.insert(botActions)
		.values({ ...data, createdAt: new Date() })
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
