#!/usr/bin/env tsx
/**
 * Get top ranked blog keywords across all blog pages, sorted by ETV.
 *
 * Usage:
 *   npx tsx scripts/run.ts seo-top-keywords
 *   npx tsx scripts/run.ts seo-top-keywords --limit=100
 */
import { parseArgs, output } from "./helpers";
import { getAllTopBlogKeywords } from "../server/lib/dataforseo";

const args = parseArgs();
const limit = Number(args.limit) || 500;

output(await getAllTopBlogKeywords(limit));
