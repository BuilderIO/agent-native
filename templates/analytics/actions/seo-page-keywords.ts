#!/usr/bin/env tsx
/**
 * Get the top ranked keywords for a specific blog page by slug.
 *
 * Usage:
 *   npx tsx scripts/run.ts seo-page-keywords --slug=micro-frontends
 */
import { parseArgs, output, fatal } from "./helpers";
import { getRankedKeywordsForPage } from "../server/lib/dataforseo";

const args = parseArgs();
if (!args.slug) fatal("--slug is required. Example: --slug=micro-frontends");

output(await getRankedKeywordsForPage(args.slug));
