/**
 * Create a calendar event on Google Calendar
 *
 * Usage:
 *   pnpm action create-event --title "Team standup" --start 2026-03-15T09:00:00 --end 2026-03-15T09:30:00
 *   pnpm action create-event --title "Lunch" --start 2026-03-15T12:00:00 --end 2026-03-15T13:00:00 --location "Cafe"
 *
 * Options:
 *   --title        Event title (required)
 *   --start        Start time, ISO format (required)
 *   --end          End time, ISO format (required)
 *   --description  Event description
 *   --location     Event location
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { agentChat } from "@agent-native/core";
import { parseArgs } from "./helpers.js";

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);

  if (!opts["title"]) {
    console.error("Error: --title is required");
    throw new Error("Script failed");
  }
  if (!opts["start"]) {
    console.error("Error: --start is required (ISO date format)");
    throw new Error("Script failed");
  }
  if (!opts["end"]) {
    console.error("Error: --end is required (ISO date format)");
    throw new Error("Script failed");
  }

  // Import the Google Calendar client
  const googleCalendar = await import("../server/lib/google-calendar.js");

  if (!(await googleCalendar.isConnected())) {
    console.error(
      "Error: Google Calendar is not connected. Connect via the Settings page first.",
    );
    agentChat.submit(
      "Cannot create event: Google Calendar is not connected. The user needs to connect via the Settings page.",
    );
    throw new Error("Script failed");
  }

  const event = {
    id: "",
    title: opts["title"],
    description: opts["description"] || "",
    location: opts["location"] || "",
    start: new Date(opts["start"]).toISOString(),
    end: new Date(opts["end"]).toISOString(),
    allDay: false,
    source: "google" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const result = await googleCalendar.createEvent(event);
    if (result.id) {
      console.log(`Created event on Google Calendar (ID: ${result.id})`);
    } else {
      console.log("Created event on Google Calendar.");
    }
  } catch (err: any) {
    console.error(`Error creating event on Google Calendar: ${err.message}`);
    agentChat.submit(
      `Failed to create event on Google Calendar: ${err.message}`,
    );
    throw new Error("Script failed");
  }

  console.log(`Event "${event.title}" created successfully.`);
  agentChat.submit(
    `Created event "${event.title}" on ${new Date(event.start).toLocaleDateString()} (${new Date(event.start).toLocaleTimeString()} – ${new Date(event.end).toLocaleTimeString()}) on Google Calendar.`,
  );
}
