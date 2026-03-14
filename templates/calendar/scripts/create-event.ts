/**
 * Create a calendar event
 *
 * Usage:
 *   pnpm script create-event --title "Team standup" --start 2026-03-15T09:00:00 --end 2026-03-15T09:30:00
 *   pnpm script create-event --title "Lunch" --start 2026-03-15T12:00:00 --end 2026-03-15T13:00:00 --location "Cafe" --google
 *
 * Options:
 *   --title        Event title (required)
 *   --start        Start time, ISO format (required)
 *   --end          End time, ISO format (required)
 *   --description  Event description
 *   --location     Event location
 *   --google       Also create on Google Calendar (flag)
 */

import { config } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { nanoid } from "nanoid";
import { agentChat } from "@agent-native/core";
import { parseArgs } from "./helpers.js";

export default async function main(args: string[]) {
  config();

  const opts = parseArgs(args);

  if (!opts["title"]) {
    console.error("Error: --title is required");
    process.exit(1);
  }
  if (!opts["start"]) {
    console.error("Error: --start is required (ISO date format)");
    process.exit(1);
  }
  if (!opts["end"]) {
    console.error("Error: --end is required (ISO date format)");
    process.exit(1);
  }

  const id = nanoid();
  const event = {
    id,
    title: opts["title"],
    description: opts["description"] || "",
    location: opts["location"] || "",
    start: new Date(opts["start"]).toISOString(),
    end: new Date(opts["end"]).toISOString(),
    allDay: false,
    source: "local" as const,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };

  // Ensure events directory exists
  const eventsDir = join("data", "events");
  mkdirSync(eventsDir, { recursive: true });

  // Write local event file
  const eventPath = join(eventsDir, `${id}.json`);
  writeFileSync(eventPath, JSON.stringify(event, null, 2));
  console.log(`Created event: ${eventPath}`);

  // Optionally create on Google Calendar
  if (opts["google"] === "true") {
    try {
      const authPath = join("data", "google-auth.json");
      const tokens = JSON.parse(readFileSync(authPath, "utf-8"));

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        console.warn("Warning: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set. Skipping Google Calendar.");
      } else {
        const { google } = await import("googleapis");
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials(tokens);

        const calendar = google.calendar({ version: "v3", auth: oauth2 });
        const googleEvent = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: event.title,
            description: event.description,
            location: event.location,
            start: { dateTime: event.start },
            end: { dateTime: event.end },
          },
        });

        // Update local event with Google ID
        const updatedEvent = {
          ...event,
          source: "google" as const,
          googleEventId: googleEvent.data.id,
          htmlLink: googleEvent.data.htmlLink || "",
        };
        writeFileSync(eventPath, JSON.stringify(updatedEvent, null, 2));
        console.log(`Also created on Google Calendar: ${googleEvent.data.htmlLink}`);
      }
    } catch (err: any) {
      console.warn(`Warning: Could not create on Google Calendar: ${err.message}`);
      console.log("Event was created locally.");
    }
  }

  console.log(`Event "${event.title}" created successfully.`);
  agentChat.submit(`Created event "${event.title}" on ${new Date(event.start).toLocaleDateString()} (${new Date(event.start).toLocaleTimeString()} – ${new Date(event.end).toLocaleTimeString()}).`);
}
