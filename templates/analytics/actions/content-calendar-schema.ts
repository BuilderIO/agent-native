#!/usr/bin/env tsx
/**
 * Get the Notion content calendar database schema.
 *
 * Usage:
 *   npx tsx scripts/run.ts content-calendar-schema
 */
import { output } from "./helpers";
import { getContentCalendarSchema } from "../server/lib/notion";

output(await getContentCalendarSchema());
