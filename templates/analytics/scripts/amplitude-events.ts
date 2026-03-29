#!/usr/bin/env tsx
/**
 * Query Amplitude analytics event data.
 *
 * Usage:
 *   pnpm script amplitude-events --event=signup_completed
 *   pnpm script amplitude-events --event=page_view --days=7
 */
import { parseArgs, output, fatal } from "./helpers";
import { queryEvents } from "../server/lib/amplitude";

const args = parseArgs();
const event = args.event;
if (!event) fatal("--event is required. Example: --event=signup_completed");

const days = parseInt(args.days || "30", 10);
const end = new Date();
const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

const result = await queryEvents(event, fmt(start), fmt(end));

output(result);
