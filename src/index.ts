import { client } from "./client.ts";
import { config } from "./config.ts";
import { registerEvents } from "./discord/register.ts";

registerEvents(client);

console.log("[boot] Starting haxxerbunny...");
await client.login(config.discord.token);
