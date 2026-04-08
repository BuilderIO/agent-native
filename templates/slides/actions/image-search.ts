import { defineAction } from "@agent-native/core";

export default defineAction({
  description:
    "Search for images using Google Custom Search API (agent CLI tool).",
  parameters: {
    query: { type: "string", description: "Search query (required)" },
    count: { type: "string", description: "Number of results (default: 10)" },
  },
  http: false,
  run: async (args) => {
    const query = args.query;
    if (!query) {
      return "Error: --query is required";
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;

    if (!apiKey || !cx) {
      return "Error: GOOGLE_API_KEY and GOOGLE_SEARCH_CX environment variables are required.";
    }

    const count = Math.min(parseInt(args.count || "10"), 10);

    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      searchType: "image",
      num: String(count),
      safe: "active",
    });

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
    );
    if (!response.ok) {
      const text = await response.text();
      return `Google API error: ${text}`;
    }

    const data = await response.json();
    const results = (data.items || []).map((item: any, i: number) => ({
      index: i + 1,
      url: item.link,
      title: item.title,
      width: item.image?.width,
      height: item.image?.height,
      thumbnail: item.image?.thumbnailLink,
    }));

    return JSON.stringify(results, null, 2);
  },
});
