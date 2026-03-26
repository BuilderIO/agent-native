import { parseArgs, loadEnv } from "@agent-native/core/scripts";

export default async function webSearch(args: string[]) {
  loadEnv();
  const { query, limit } = parseArgs(args);

  if (!query) {
    console.error("Usage: pnpm script web-search --query 'search terms' [--limit 10]");
    process.exit(1);
  }

  const maxResults = parseInt(limit || "10", 10);
  const apiKey = process.env.SEARCH_API_KEY;

  if (!apiKey) {
    console.log("No SEARCH_API_KEY set. To enable web search, add SEARCH_API_KEY to .env");
    console.log("Supported providers: Brave Search, Serper, Perplexity");
    console.log(`\nQuery: "${query}"`);
    console.log("Tip: Use web-fetch with specific URLs as a fallback.");
    return;
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      console.error(`Search API error: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const data = await response.json();
    const results = (data.web?.results || []).slice(0, maxResults);

    for (const result of results) {
      console.log(`## ${result.title}`);
      console.log(`URL: ${result.url}`);
      console.log(`${result.description || ""}`);
      console.log("");
    }

    console.log(`Found ${results.length} results for "${query}"`);
  } catch (err: any) {
    console.error("Search failed:", err.message);
    process.exit(1);
  }
}
