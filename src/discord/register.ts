import type { Client } from "discord.js";
import { handleMessageCreate } from "./events/messageCreate.ts";
import { handleMessageReactionAdd } from "./events/messageReactionAdd.ts";
import { handleReady } from "./events/ready.ts";

export function registerEvents(client: Client): void {
	client.once("ready", handleReady);
	client.on("messageCreate", handleMessageCreate);
	client.on("messageReactionAdd", handleMessageReactionAdd);
}
