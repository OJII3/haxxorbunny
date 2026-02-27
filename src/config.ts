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
		baseUrl:
			process.env.LLM_API_BASE_URL ??
			"https://generativelanguage.googleapis.com/v1beta/openai/",
		apiKey: requiredEnv("GEMINI_API_KEY"),
		model: process.env.LLM_MODEL ?? "gemini-3-flash-preview",
	},
	triage: {
		baseUrl:
			process.env.TRIAGE_API_BASE_URL ??
			process.env.LLM_API_BASE_URL ??
			"https://generativelanguage.googleapis.com/v1beta/openai/",
		apiKey: process.env.TRIAGE_API_KEY ?? requiredEnv("GEMINI_API_KEY"),
		model: process.env.TRIAGE_MODEL ?? "gemini-3-flash-preview",
		throttleMs: Number(process.env.TRIAGE_THROTTLE_MS ?? "10000"),
		responseCooldownMs: Number(
			process.env.TRIAGE_RESPONSE_COOLDOWN_MS ?? "15000",
		),
		responseCooldownMentionMs: Number(
			process.env.TRIAGE_RESPONSE_COOLDOWN_MENTION_MS ?? "5000",
		),
	},
	messageBuffer: {
		ms: Number(process.env.MESSAGE_BUFFER_MS ?? "3000"),
		maxMs: Number(process.env.MESSAGE_BUFFER_MAX_MS ?? "15000"),
	},
	search: {
		endpoint: process.env.SEARXNG_URL ?? "",
	},
	thinking: {
		baseUrl:
			process.env.THINKING_API_BASE_URL ??
			process.env.LLM_API_BASE_URL ??
			"https://generativelanguage.googleapis.com/v1beta/openai/",
		apiKey: process.env.THINKING_API_KEY ?? requiredEnv("GEMINI_API_KEY"),
		model: process.env.THINKING_MODEL ?? "gemini-3-pro-preview",
	},
	voice: {
		sttUrl:
			process.env.STT_URL ?? process.env.WHISPER_URL ?? "http://localhost:8090",
		voicevoxUrl: process.env.VOICEVOX_URL ?? "http://localhost:50021",
		voicevoxSpeaker: Number(process.env.VOICEVOX_SPEAKER ?? "1"),
		silenceTimeoutMs: Number(process.env.VOICE_SILENCE_TIMEOUT_MS ?? "300000"),
		vadThreshold: Number(process.env.VOICE_VAD_THRESHOLD ?? "500"),
		maxSessionMs: Number(process.env.VOICE_MAX_SESSION_MS ?? "600000"),
	},
} as const;
