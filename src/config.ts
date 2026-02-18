const requiredEnv = (key: string): string => {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
};

export const config = {
	discord: {
		token: requiredEnv("DISCORD_TOKEN"),
		appId: requiredEnv("DISCORD_APP_ID"),
		guildId: process.env.DISCORD_GUILD_ID ?? null,
	},
	llm: {
		baseUrl: process.env.LLM_API_BASE_URL ?? "http://localhost:3000/v1",
		apiKey: process.env.LLM_API_KEY ?? "dummy",
		model: process.env.LLM_MODEL ?? "gemini",
	},
	triage: {
		baseUrl:
			process.env.TRIAGE_API_BASE_URL ??
			process.env.LLM_API_BASE_URL ??
			"http://localhost:3000/v1",
		apiKey: process.env.TRIAGE_API_KEY ?? process.env.LLM_API_KEY ?? "dummy",
		model: process.env.TRIAGE_MODEL ?? "gemini-3-flash-preview",
		throttleMs: Number(process.env.TRIAGE_THROTTLE_MS ?? "2000"),
	},
} as const;
