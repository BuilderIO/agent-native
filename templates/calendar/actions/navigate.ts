/**
 * Navigate the UI to a view, date, or event.
 *
 * Writes a navigate command to application state which the UI reads and auto-deletes.
 *
 * Usage:
 *   pnpm action navigate --view=calendar
 *   pnpm action navigate --view=calendar --date=2026-04-15
 *   pnpm action navigate --view=calendar --calendarViewMode=day
 *   pnpm action navigate --view=calendar --calendarViewMode=month --date=2026-05-01
 *   pnpm action navigate --view=calendar --eventId=abc123
 *   pnpm action navigate --view=availability
 *   pnpm action navigate --view=booking-links
 *   pnpm action navigate --view=bookings
 *   pnpm action navigate --view=settings
 *
 * Options:
 *   --view              View to navigate to (calendar, availability, booking-links, bookings, settings)
 *   --calendarViewMode  Calendar display mode: day, week, or month
 *   --date              Date to jump to on the calendar (YYYY-MM-DD)
 *   --eventId           Event ID to open
 */

import { parseArgs } from "./helpers.js";
import { writeAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
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
      calendarViewMode: {
        type: "string",
        description:
          "Calendar display mode: day, week, or month. Use this to switch between day/week/month views.",
        enum: ["day", "week", "month"],
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
  if (!args.view && !args.date && !args.eventId && !args.calendarViewMode) {
    return "Error: At least --view, --date, --calendarViewMode, or --eventId is required.";
  }
  const nav: Record<string, string> = {};
  if (args.view) nav.view = args.view;
  if (args.calendarViewMode) nav.calendarViewMode = args.calendarViewMode;
  if (args.date) nav.date = args.date;
  if (args.eventId) nav.eventId = args.eventId;
  await writeAppState("navigate", nav);

  const parts: string[] = [];
  if (args.view) parts.push(args.view);
  if (args.calendarViewMode) parts.push(`mode:${args.calendarViewMode}`);
  if (args.date) parts.push(`date:${args.date}`);
  if (args.eventId) parts.push(`event:${args.eventId}`);
  return `Navigating to ${parts.join(" ")}`;
}

export default async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv) as Record<string, string>;
  if (!args.view && !args.date && !args.eventId && !args.calendarViewMode) {
    console.error(
      "Error: At least --view, --date, --calendarViewMode, or --eventId is required.\n" +
        "Usage: pnpm action navigate --view=calendar --calendarViewMode=day --date=2026-04-15",
    );
    process.exit(1);
  }
  const result = await run(args);
  console.error(result);
  console.log(JSON.stringify({ result }));
}
