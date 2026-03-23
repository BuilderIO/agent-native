/**
 * List calendar events from Google Calendar
 *
 * Usage:
 *   pnpm script list-events
 *   pnpm script list-events --from 2026-03-01 --to 2026-03-31
 *
 * Options:
 *   --from    Start date filter (ISO date, default: 7 days ago)
 *   --to      End date filter (ISO date, default: 30 days forward)
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { agentChat } from "@agent-native/core";
import { parseArgs, formatDateRange } from "./helpers.js";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  source: "local" | "google";
  location?: string;
  allDay?: boolean;
  accountEmail?: string;
}

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const defaultTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const from = opts["from"]
    ? new Date(opts["from"]).toISOString()
    : defaultFrom.toISOString();
  const to = opts["to"]
    ? new Date(opts["to"]).toISOString()
    : defaultTo.toISOString();

  // Import the Google Calendar client
  const googleCalendar = await import("../server/lib/google-calendar.js");

  if (!(await googleCalendar.isConnected())) {
    console.log(
      "Google Calendar is not connected. Connect via the Settings page first.",
    );
    agentChat.submit(
      "Google Calendar is not connected. The user needs to connect via the Settings page.",
    );
    return;
  }

  const { events, errors } = await googleCalendar.listEvents(from, to);

  if (errors.length > 0) {
    for (const err of errors) {
      console.warn(`Warning: Error fetching from ${err.email}: ${err.error}`);
    }
  }

  if (events.length === 0) {
    console.log("No events found in the specified date range.");
    agentChat.submit("No events found matching the given filters.");
    return;
  }

  // Sort by start time
  events.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  // Print formatted table
  console.log("");
  console.log(
    `${"Title".padEnd(40)} ${"Date / Time".padEnd(40)} ${"Source".padEnd(8)} Location`,
  );
  console.log(
    `${"─".repeat(40)} ${"─".repeat(40)} ${"─".repeat(8)} ${"─".repeat(20)}`,
  );

  for (const event of events) {
    const title =
      event.title.length > 38 ? event.title.slice(0, 35) + "..." : event.title;
    const dateRange = event.allDay
      ? `${new Date(event.start).toLocaleDateString()} (all day)`
      : formatDateRange(event.start, event.end);
    const loc = event.location || "";

    console.log(
      `${title.padEnd(40)} ${dateRange.padEnd(40)} ${(event.source || "google").padEnd(8)} ${loc}`,
    );
  }

  console.log("");
  console.log(`Total: ${events.length} event(s)`);
  agentChat.submit(
    `Found ${events.length} event(s) from ${new Date(from).toLocaleDateString()} to ${new Date(to).toLocaleDateString()}.`,
  );
}
