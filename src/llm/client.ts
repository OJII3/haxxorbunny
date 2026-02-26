import OpenAI from "openai";
import { config } from "../config.ts";

export const llm = new OpenAI({
	baseURL: config.llm.baseUrl,
	apiKey: config.llm.apiKey,
	timeout: 60_000,
	maxRetries: 2,
});
