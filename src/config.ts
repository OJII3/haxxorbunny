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
} as const;
