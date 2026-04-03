/**
 * Search calendar events by title
 *
 * Usage:
 *   pnpm action search-events --query "Builder"
 *   pnpm action search-events --query "Salesforce" --from 2026-03-01 --to 2026-04-01
 *
 * Options:
 *   --query   Search term (case-insensitive substring match on title, required)
 *   --from    Start date filter (ISO date, default: 7 days ago)
 *   --to      End date filter (ISO date, default: 30 days forward)
 *
 * Output: JSON array of matching events with full details including attendees.
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { parseArgs, parseDate } from "./helpers.js";

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);
  const query = opts["query"] || opts["q"];

  if (!query) {
    console.error("Error: --query is required");
    console.error('Usage: pnpm action search-events --query "meeting title"');
    process.exit(1);
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const defaultTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const from = opts["from"]
    ? parseDate(opts["from"]).toISOString()
    : defaultFrom.toISOString();
  const to = opts["to"]
    ? parseDate(opts["to"]).toISOString()
    : defaultTo.toISOString();

  const googleCalendar = await import("../server/lib/google-calendar.js");

  if (!(await googleCalendar.isConnected())) {
    console.log(
      "Google Calendar is not connected. Connect via the Settings page first.",
    );
    return;
  }

  const { events, errors } = await googleCalendar.listEvents(from, to);

  if (errors.length > 0) {
    for (const err of errors) {
      console.warn(`Warning: Error fetching from ${err.email}: ${err.error}`);
    }
  }

  // Filter by title (case-insensitive substring match)
  const queryLower = query.toLowerCase();
  const matches = events.filter((e) =>
    e.title.toLowerCase().includes(queryLower),
  );

  if (matches.length === 0) {
    console.log(`No events matching "${query}" found.`);
    return;
  }

  // Output full event details as JSON
  const output = matches.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description || undefined,
    start: e.start,
    end: e.end,
    location: e.location || undefined,
    attendees: e.attendees || [],
    conferenceData: e.conferenceData || undefined,
    hangoutLink: e.hangoutLink || undefined,
    status: e.status || undefined,
    recurrence: e.recurrence || undefined,
  }));

  console.log(JSON.stringify(output, null, 2));
  console.log(`\n${matches.length} event(s) matching "${query}"`);
}
