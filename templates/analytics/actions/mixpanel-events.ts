#!/usr/bin/env tsx
/**
 * Query Mixpanel event data.
 *
 * Usage:
 *   pnpm action mixpanel-events --days=30
 *   pnpm action mixpanel-events --event=signup --days=7
 */
import { parseArgs, output } from "./helpers";
import { queryEvents } from "../server/lib/mixpanel";

const args = parseArgs();
const days = parseInt(args.days || "30", 10);
const end = new Date();
const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

const eventNames = args.event ? [args.event] : undefined;
const result = await queryEvents(fmt(start), fmt(end), eventNames);

output(result);
