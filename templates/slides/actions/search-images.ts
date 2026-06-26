import { defineAction } from "@agent-native/core";
import { resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description: "Search for images using Google Custom Search API.",
  schema: z.object({
    q: z.string().optional().describe("Search query (required)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const q = args.q;
    if (!q) {
      throw new Error("Missing query parameter 'q'");
    }

    const [apiKey, cx] = await Promise.all([
      resolveSecret("GOOGLE_API_KEY"),
      resolveSecret("GOOGLE_SEARCH_CX"),
    ]);

    if (!apiKey || !cx) {
      throw new Error(
        "Google Search not configured. Save GOOGLE_API_KEY and GOOGLE_SEARCH_CX in settings.",
      );
    }

    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q,
      searchType: "image",
      num: "10",
      safe: "active",
    });

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
    );
    if (!response.ok) {
      const text = await response.text();
      console.error("Google API error:", response.status, text);
      throw new Error("Google API error");
    }

    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      url: item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      title: item.title,
      width: item.image?.width,
      height: item.image?.height,
    }));
  },
});
