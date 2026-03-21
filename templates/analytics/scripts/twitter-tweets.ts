#!/usr/bin/env tsx
/**
 * Get recent tweets for a Twitter/X user.
 *
 * Usage:
 *   npx tsx scripts/run.ts twitter-tweets --userName=builderio
 *   npx tsx scripts/run.ts twitter-tweets --userName=builderio --pages=3
 */
import { parseArgs, output, fatal } from "./helpers";
import { fetchAllTweetsForUser } from "../server/handlers/twitter";

const args = parseArgs();
if (!args.userName)
  fatal("--userName is required. Example: --userName=builderio");

const pages = Math.min(Number(args.pages) || 5, 10);
const apiKey = process.env.TWITTER_API_KEY;
if (!apiKey) fatal("TWITTER_API_KEY environment variable not configured");

const tweets = await fetchAllTweetsForUser(apiKey, args.userName, pages);
output({ tweets, count: tweets.length });
