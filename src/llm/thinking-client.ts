import OpenAI from "openai";
import { config } from "../config.ts";

export const thinkingLlm = new OpenAI({
	baseURL: config.thinking.baseUrl,
	apiKey: config.thinking.apiKey,
});
