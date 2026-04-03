/**
 * Navigate the UI to a view, date, or event.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm script navigate --view=calendar
 *   pnpm script navigate --view=calendar --date=2026-04-15
 *   pnpm script navigate --view=calendar --eventId=abc123
 *   pnpm script navigate --view=availability
 *   pnpm script navigate --view=booking-links
 *   pnpm script navigate --view=bookings
 *   pnpm script navigate --view=settings
 *
 * Options:
 *   --view       View to navigate to (calendar, availability, booking-links, bookings, settings)
 *   --date       Date to jump to on the calendar (YYYY-MM-DD)
 *   --eventId    Event ID to open
 */

import { parseArgs } from "./helpers.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Navigate the UI to a specific view, date, or event. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    type: "object",
    properties: {
      view: {
        type: "string",
        description:
          "View to navigate to (calendar, availability, booking-links, bookings, settings)",
      },
      date: {
        type: "string",
        description: "Date to jump to on the calendar (YYYY-MM-DD)",
      },
      eventId: {
        type: "string",
        description: "Event ID to open",
      },
    },
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  if (!args.view && !args.date && !args.eventId) {
    return "Error: At least --view, --date, or --eventId is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.date) nav.date = args.date;
  if (args.eventId) nav.eventId = args.eventId;
  await writeAppState("navigate", nav);

  const parts: string[] = [];
  if (args.view) parts.push(args.view);
  if (args.date) parts.push(`date:${args.date}`);
  if (args.eventId) parts.push(`event:${args.eventId}`);
  return `Navigating to ${parts.join(" ")}`;
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.view && !args.date && !args.eventId) {
    console.error(
      "Error: At least --view, --date, or --eventId is required.\n" +
        "Usage: pnpm script navigate --view=calendar --date=2026-04-15",
    );
    process.exit(1);
  }
  const result = await run(args);
  console.error(result);
  console.log(JSON.stringify({ result }));
}
