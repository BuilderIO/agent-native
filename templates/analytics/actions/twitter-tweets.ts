import { defineAction } from "@agent-native/core";
import { fetchAllTweetsForUser } from "../server/handlers/twitter";

export default defineAction({
  description: "Get recent tweets for a Twitter/X user.",
  parameters: {
    userName: { type: "string", description: "Twitter username (required)" },
    pages: {
      type: "string",
      description: "Number of pages to fetch (default 5, max 10)",
    },
  },
  http: false,
  run: async (args) => {
    if (!args.userName) return { error: "userName is required" };

    const pages = Math.min(Number(args.pages) || 5, 10);
    const apiKey = process.env.TWITTER_API_KEY;
    if (!apiKey)
      return { error: "TWITTER_API_KEY environment variable not configured" };

    const tweets = await fetchAllTweetsForUser(apiKey, args.userName, pages);
    return { tweets, count: tweets.length };
  },
});
