/**
 * List calendar events with optional filtering
 *
 * Usage:
 *   pnpm script list-events
 *   pnpm script list-events --from 2026-03-01 --to 2026-03-31
 *   pnpm script list-events --source google
 *
 * Options:
 *   --from    Start date filter (ISO date)
 *   --to      End date filter (ISO date)
 *   --source  Filter by source: local, google, or all (default: all)
 */

import { config } from "dotenv";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
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
  status?: string;
}

export default async function main(args: string[]) {
  config();

  const opts = parseArgs(args);
  const source = opts["source"] || "all";
  const from = opts["from"] ? new Date(opts["from"]) : null;
  const to = opts["to"] ? new Date(opts["to"]) : null;

  const eventsDir = join("data", "events");
  let files: string[];
  try {
    files = readdirSync(eventsDir).filter((f) => f.endsWith(".json"));
  } catch {
    console.log("No events found (data/events/ directory does not exist).");
    agentChat.submit("No events found.");
    return;
  }

  // Load and parse all events
  const events: CalendarEvent[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(eventsDir, file), "utf-8");
      events.push(JSON.parse(raw));
    } catch {
      // Skip malformed files
    }
  }

  // Filter by source
  let filtered = events;
  if (source !== "all") {
    filtered = filtered.filter((e) => e.source === source);
  }

  // Filter by date range
  if (from) {
    filtered = filtered.filter((e) => new Date(e.start) >= from);
  }
  if (to) {
    filtered = filtered.filter((e) => new Date(e.start) <= to);
  }

  // Sort by start time
  filtered.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (filtered.length === 0) {
    console.log("No events found matching the criteria.");
    agentChat.submit("No events found matching the given filters.");
    return;
  }

  // Print formatted table
  console.log("");
  console.log(`${"Title".padEnd(40)} ${"Date / Time".padEnd(40)} ${"Source".padEnd(8)} Location`);
  console.log(`${"─".repeat(40)} ${"─".repeat(40)} ${"─".repeat(8)} ${"─".repeat(20)}`);

  for (const event of filtered) {
    const title = event.title.length > 38 ? event.title.slice(0, 35) + "..." : event.title;
    const dateRange = event.allDay ? `${new Date(event.start).toLocaleDateString()} (all day)` : formatDateRange(event.start, event.end);
    const loc = event.location || "";

    console.log(`${title.padEnd(40)} ${dateRange.padEnd(40)} ${event.source.padEnd(8)} ${loc}`);
  }

  console.log("");
  console.log(`Total: ${filtered.length} event(s)`);
  agentChat.submit(`Found ${filtered.length} event(s)${from || to ? " in the specified date range" : ""}.`);
}
