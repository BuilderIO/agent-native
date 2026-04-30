import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchAllTweetsForUser } from "../server/handlers/twitter";
import { resolveCredential } from "../server/lib/credentials";
import { requireRequestCredentialContext } from "../server/lib/credentials-context";

export default defineAction({
  description: "Get recent tweets for a Twitter/X user.",
  schema: z.object({
    userName: z.string().optional().describe("Twitter username (required)"),
    pages: z.coerce
      .number()
      .optional()
      .describe("Number of pages to fetch (default 5, max 10)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.userName) return { error: "userName is required" };

    const pages = Math.min(args.pages ?? 5, 10);
    const ctx = requireRequestCredentialContext("TWITTER_BEARER_TOKEN");
    const apiKey = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
    if (!apiKey)
      return { error: "TWITTER_BEARER_TOKEN credential not configured" };

    const tweets = await fetchAllTweetsForUser(apiKey, args.userName, pages);
    return { tweets, count: tweets.length };
  },
});
