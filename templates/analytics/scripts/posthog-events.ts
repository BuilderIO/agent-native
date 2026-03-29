#!/usr/bin/env tsx
/**
 * Query PostHog analytics event data.
 *
 * Usage:
 *   pnpm script posthog-events --event="$pageview"
 *   pnpm script posthog-events --event=signup --days=7
 */
import { parseArgs, output } from "./helpers";
import { queryEvents } from "../server/lib/posthog";

const args = parseArgs();
const event = args.event || undefined;
const limit = parseInt(args.limit || "100", 10);

const result = await queryEvents(event, limit);

output(result);
