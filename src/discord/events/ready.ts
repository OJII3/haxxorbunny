import type { Client } from "discord.js";

export function handleReady(client: Client<true>): void {
	console.log(`[ready] Logged in as ${client.user.tag}`);
}
