import { google } from "googleapis";
import path from "path";
import type { CalendarEvent, GoogleAuthStatus } from "../../shared/api.js";
import { readJsonFile, writeJsonFile, deleteJsonFile } from "./data-helpers.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const TOKENS_PATH = path.join(process.cwd(), "data", "google-auth.json");

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function createOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri ?? "http://localhost:8080/api/google/callback",
  );
}

export function getAuthUrl(origin?: string, redirectUri?: string): string {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(
  code: string,
  origin?: string,
  redirectUri?: string,
): Promise<void> {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  const { tokens } = await client.getToken(code);
  writeJsonFile(TOKENS_PATH, tokens);
}

export async function getClient() {
  const tokens = readJsonFile<GoogleTokens>(TOKENS_PATH);
  if (!tokens) return null;

  const client = createOAuth2Client();
  client.setCredentials(tokens);

  // Handle token refresh
  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    writeJsonFile(TOKENS_PATH, merged);
  });

  return client;
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const client = await getClient();
  if (!client) return [];

  const calendar = google.calendar({ version: "v3", auth: client });
  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.data.items || [];
  return events.map((event) => ({
    id: `google-${event.id}`,
    title: event.summary || "Untitled",
    description: event.description || "",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    location: event.location || "",
    allDay: !event.start?.dateTime,
    source: "google" as const,
    googleEventId: event.id || undefined,
    createdAt: event.created || new Date().toISOString(),
    updatedAt: event.updated || new Date().toISOString(),
  }));
}

export async function createEvent(
  event: CalendarEvent,
): Promise<string | undefined> {
  const client = await getClient();
  if (!client) return undefined;

  const calendar = google.calendar({ version: "v3", auth: client });
  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.title,
      description: event.description,
      location: event.location,
      start: event.allDay
        ? { date: event.start.split("T")[0] }
        : { dateTime: event.start },
      end: event.allDay
        ? { date: event.end.split("T")[0] }
        : { dateTime: event.end },
    },
  });

  return response.data.id || undefined;
}

export async function updateEvent(
  googleEventId: string,
  event: Partial<CalendarEvent>,
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  const calendar = google.calendar({ version: "v3", auth: client });
  const requestBody: any = {};
  if (event.title !== undefined) requestBody.summary = event.title;
  if (event.description !== undefined)
    requestBody.description = event.description;
  if (event.location !== undefined) requestBody.location = event.location;
  if (event.start !== undefined) {
    requestBody.start = event.allDay
      ? { date: event.start.split("T")[0] }
      : { dateTime: event.start };
  }
  if (event.end !== undefined) {
    requestBody.end = event.allDay
      ? { date: event.end.split("T")[0] }
      : { dateTime: event.end };
  }

  await calendar.events.update({
    calendarId: "primary",
    eventId: googleEventId,
    requestBody,
  });
}

export async function deleteEvent(googleEventId: string): Promise<void> {
  const client = await getClient();
  if (!client) return;

  const calendar = google.calendar({ version: "v3", auth: client });
  await calendar.events.delete({
    calendarId: "primary",
    eventId: googleEventId,
  });
}

export function isConnected(): boolean {
  const tokens = readJsonFile<GoogleTokens>(TOKENS_PATH);
  if (!tokens) return false;
  if (
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() &&
    !tokens.refresh_token
  ) {
    return false;
  }
  return true;
}

export async function getAuthStatus(): Promise<GoogleAuthStatus> {
  const tokens = readJsonFile<GoogleTokens>(TOKENS_PATH);
  if (!tokens) {
    return { connected: false };
  }

  return {
    connected: true,
    expiresAt: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : undefined,
  };
}

export function disconnect(): void {
  deleteJsonFile(TOKENS_PATH);
}
