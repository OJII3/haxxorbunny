import { client } from "./client.ts";
import { config } from "./config.ts";
import { runMigrations } from "./db/migrate.ts";
import { registerEvents } from "./discord/register.ts";

runMigrations();
registerEvents(client);

console.log("[boot] Starting haxxerbunny...");
await client.login(config.discord.token);
