import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	channelId: text("channel_id").notNull(),
	userId: text("user_id").notNull(),
	username: text("username").notNull(),
	content: text("content").notNull(),
	isBot: integer("is_bot", { mode: "boolean" }).default(false),
	createdAt: integer("created_at", { mode: "timestamp" }).default(new Date()),
});

export const botActions = sqliteTable("bot_actions", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	action: text("action").notNull(),
	channelId: text("channel_id"),
	content: text("content"),
	reasoning: text("reasoning"),
	triggeredBy: text("triggered_by"),
	createdAt: integer("created_at", { mode: "timestamp" }).default(new Date()),
});
