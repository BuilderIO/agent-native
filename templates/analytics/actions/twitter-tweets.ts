import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchAllTweetsForUser } from "../server/handlers/twitter";
import { resolveCredential } from "../server/lib/credentials";
import { requireRequestCredentialContext } from "../server/lib/credentials-context";

export default defineAction({
  description:
    "Get recent tweets for one or more Twitter/X users. Use userName for one account or userNames for a comma-separated multi-user query.",
  schema: z.object({
    userName: z.string().optional().describe("Twitter username"),
    userNames: z
      .string()
      .optional()
      .describe("Comma-separated Twitter usernames, max 10"),
    pages: z.coerce
      .number()
      .optional()
      .describe("Number of pages to fetch (default 5, max 10)"),
  }),
  http: false,
  run: async (args) => {
    const userNames = args.userNames
      ? args.userNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : args.userName
        ? [args.userName]
        : [];
    if (userNames.length === 0) return { error: "userName is required" };
    if (userNames.length > 10) return { error: "Max 10 usernames at a time" };

    const pages = Math.min(args.pages ?? 5, 10);
    const ctx = requireRequestCredentialContext("TWITTER_BEARER_TOKEN");
    const apiKey = await resolveCredential("TWITTER_BEARER_TOKEN", ctx);
    if (!apiKey)
      return { error: "TWITTER_BEARER_TOKEN credential not configured" };

    if (userNames.length > 1) {
      const users: Record<string, unknown[]> = {};
      for (const userName of userNames) {
        users[userName] = await fetchAllTweetsForUser(apiKey, userName, pages);
      }
      return { users, count: Object.keys(users).length };
    }

    const tweets = await fetchAllTweetsForUser(apiKey, userNames[0], pages);
    return { tweets, count: tweets.length };
  },
});
