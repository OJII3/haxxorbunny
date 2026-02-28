import { config } from "../../config.ts";
import type { ToolDefinition, ToolHandler, ToolResult } from "../types.ts";

function ok(result: string): ToolResult {
	return { success: true, result };
}

function fail(result: string): ToolResult {
	return { success: false, result };
}

interface SearXNGResult {
	title: string;
	url: string;
	content: string;
}

// ── core function (used by pipeline execution) ──

export async function webSearchCore(params: {
	query: string;
}): Promise<ToolResult> {
	const { query } = params;
	if (!query) return fail("query is required");

	const endpoint = config.search.endpoint;
	if (!endpoint) return fail("Search endpoint is not configured");

	try {
		const url = new URL("/search", endpoint);
		url.searchParams.set("q", query);
		url.searchParams.set("format", "json");
		url.searchParams.set("categories", "general");

		const response = await fetch(url.toString(), {
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			return fail(`Search API error: ${response.status}`);
		}

		const data = (await response.json()) as { results: SearXNGResult[] };
		const results = (data.results ?? []).slice(0, 5);

		if (results.length === 0) {
			return ok("No results found.");
		}

		const formatted = results
			.map(
				(r, i) =>
					`${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content?.slice(0, 200) ?? ""}`,
			)
			.join("\n\n");

		return ok(`Search results for "${query}":\n\n${formatted}`);
	} catch (error) {
		return fail(
			`Search failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// ── handlers ──

const webSearchHandler: ToolHandler = async (args) => {
	return webSearchCore({ query: args.query as string });
};

const fetchUrlHandler: ToolHandler = async (args) => {
	const url = args.url as string;
	if (!url) return fail("url is required");

	try {
		new URL(url); // validate
	} catch {
		return fail("Invalid URL");
	}

	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
			headers: {
				"User-Agent": "bot-sekai/1.0",
			},
		});

		if (!response.ok) {
			return fail(`HTTP ${response.status}: ${response.statusText}`);
		}

		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("text/") && !contentType.includes("json")) {
			return fail(`Unsupported content type: ${contentType}`);
		}

		let text = await response.text();

		// HTML → テキスト変換（簡易）
		if (contentType.includes("text/html")) {
			text = text
				.replace(/<script[\s\S]*?<\/script>/gi, "")
				.replace(/<style[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}

		// 2000字制限
		if (text.length > 2000) {
			text = `${text.slice(0, 2000)}... (truncated)`;
		}

		return ok(text);
	} catch (error) {
		return fail(
			`Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

export const webTools: ToolDefinition[] = [
	{
		spec: {
			type: "function",
			function: {
				name: "web_search",
				description: "Web検索を行い、上位5件の結果を返す",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "検索クエリ",
						},
					},
					required: ["query"],
				},
			},
		},
		handler: webSearchHandler,
	},
	{
		spec: {
			type: "function",
			function: {
				name: "fetch_url",
				description: "URLの内容を取得する（HTML→テキスト変換、2000字制限）",
				parameters: {
					type: "object",
					properties: {
						url: {
							type: "string",
							description: "取得するURL",
						},
					},
					required: ["url"],
				},
			},
		},
		handler: fetchUrlHandler,
	},
];
