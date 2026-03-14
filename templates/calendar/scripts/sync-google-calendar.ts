/**
 * Sync Google Calendar events to data/events/
 *
 * Usage:
 *   pnpm script sync-google-calendar
 *   pnpm script sync-google-calendar --from 2026-01-01 --to 2026-06-01
 *
 * Options:
 *   --from   Start date (ISO, default: 30 days ago)
 *   --to     End date (ISO, default: 90 days forward)
 */

import { config } from "dotenv";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { google } from "googleapis";
import { agentChat } from "@agent-native/core";
import { parseArgs } from "./helpers.js";

interface GoogleAuthTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export default async function main(args: string[]) {
  config();

  const opts = parseArgs(args);

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const defaultTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const from = opts["from"] ? new Date(opts["from"]) : defaultFrom;
  const to = opts["to"] ? new Date(opts["to"]) : defaultTo;

  // Read Google auth tokens
  const authPath = join("data", "google-auth.json");
  let tokens: GoogleAuthTokens;
  try {
    tokens = JSON.parse(readFileSync(authPath, "utf-8"));
  } catch {
    console.error("Error: Google Calendar not connected. No auth tokens found at data/google-auth.json");
    console.error("Connect Google Calendar from the Settings page first.");
    process.exit(1);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env");
    process.exit(1);
  }

  // Set up OAuth2 client
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials(tokens);

  // Refresh token if expired
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    console.log("Refreshing expired access token...");
    const { credentials } = await oauth2.refreshAccessToken();
    oauth2.setCredentials(credentials);
    writeFileSync(authPath, JSON.stringify(credentials, null, 2));
  }

  const calendar = google.calendar({ version: "v3", auth: oauth2 });

  console.log(`Syncing events from ${from.toISOString()} to ${to.toISOString()}...`);

  // Fetch events from Google Calendar
  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const events = response.data.items || [];
  console.log(`Fetched ${events.length} events from Google Calendar`);

  // Ensure events directory exists
  const eventsDir = join("data", "events");
  mkdirSync(eventsDir, { recursive: true });

  let synced = 0;
  for (const event of events) {
    if (!event.id) continue;

    const localEvent = {
      id: event.id,
      title: event.summary || "(No title)",
      description: event.description || "",
      location: event.location || "",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || "",
      allDay: !event.start?.dateTime,
      source: "google" as const,
      googleEventId: event.id,
      status: event.status || "confirmed",
      htmlLink: event.htmlLink || "",
      syncedAt: new Date().toISOString(),
    };

    writeFileSync(join(eventsDir, `${event.id}.json`), JSON.stringify(localEvent, null, 2));
    synced++;
  }

  console.log(`Synced ${synced} events to data/events/`);
  agentChat.submit(`Google Calendar sync complete: ${synced} events synced from ${from.toLocaleDateString()} to ${to.toLocaleDateString()}.`);
}
