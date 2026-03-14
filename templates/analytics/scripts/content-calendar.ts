#!/usr/bin/env tsx
/**
 * Get all entries from the Notion content calendar.
 *
 * Usage:
 *   npx tsx scripts/run.ts content-calendar
 */
import { output } from "./helpers";
import { getContentCalendar } from "../server/lib/notion";

output(await getContentCalendar());
