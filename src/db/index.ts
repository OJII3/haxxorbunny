import { Database } from "bun:sqlite";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

const DB_PATH = join(import.meta.dir, "../../data/haxxorbunny.db");

const sqlite = new Database(DB_PATH, { create: true });
sqlite.run("PRAGMA journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
