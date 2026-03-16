#!/usr/bin/env tsx
/**
 * Get SEO metrics for all blog pages.
 *
 * Usage:
 *   npx tsx scripts/run.ts seo-blog-pages
 */
import { output } from "./helpers";
import { getAllBlogPagesSeo } from "../server/lib/dataforseo";

output(await getAllBlogPagesSeo());
