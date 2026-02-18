import OpenAI from "openai";
import { config } from "../config.ts";

export const triageLlm = new OpenAI({
	baseURL: config.triage.baseUrl,
	apiKey: config.triage.apiKey,
});
