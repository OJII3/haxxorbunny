import OpenAI from "openai";
import { config } from "../config.ts";

export const llm = new OpenAI({
	baseURL: config.llm.baseUrl,
	apiKey: config.llm.apiKey,
});
