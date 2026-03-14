#!/usr/bin/env tsx
/**
 * Get recent tweets for multiple Twitter/X users at once.
 *
 * Usage:
 *   npx tsx scripts/run.ts twitter-multi --userNames=builderio,steve8708
 *   npx tsx scripts/run.ts twitter-multi --userNames=builderio,steve8708 --pages=3
 */
import { parseArgs, output, fatal } from "./helpers";
import { fetchAllTweetsForUser } from "../server/routes/twitter";

const args = parseArgs();
if (!args.userNames)
  fatal(
    "--userNames is required (comma-separated). Example: --userNames=builderio,steve8708",
  );

const userNames = args.userNames
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
if (userNames.length > 10) fatal("Max 10 usernames at a time");

const pages = Math.min(Number(args.pages) || 5, 10);
const apiKey = process.env.TWITTER_API_KEY;
if (!apiKey) fatal("TWITTER_API_KEY environment variable not configured");

const result: Record<string, unknown[]> = {};
for (const u of userNames) {
  result[u] = await fetchAllTweetsForUser(apiKey, u, pages);
}
output({ users: result });
