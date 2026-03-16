import { google, type Auth } from "googleapis";
import fs from "fs";
import path from "path";
import type { CalendarEvent, GoogleAuthStatus } from "../../shared/api.js";
import { readJsonFile, writeJsonFile, deleteJsonFile } from "./data-helpers.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

const ACCOUNTS_DIR = path.join(process.cwd(), "data", "google-accounts");
const LEGACY_TOKENS_PATH = path.join(process.cwd(), "data", "google-auth.json");

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function ensureAccountsDir(): void {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function getAccountFiles(): string[] {
  ensureAccountsDir();
  try {
    return fs
      .readdirSync(ACCOUNTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(ACCOUNTS_DIR, f));
  } catch {
    return [];
  }
}

/**
 * Migrate legacy single-token file to multi-account format.
 * Uses a module-level promise to ensure only one migration runs at a time.
 */
let migrationPromise: Promise<void> | null = null;

async function migrateLegacyTokens(): Promise<void> {
  if (!fs.existsSync(LEGACY_TOKENS_PATH)) return;
  if (!migrationPromise) {
    migrationPromise = doMigrateLegacyTokens().finally(() => {
      migrationPromise = null;
    });
  }
  return migrationPromise;
}

async function doMigrateLegacyTokens(): Promise<void> {
  const tokens = readJsonFile<GoogleTokens>(LEGACY_TOKENS_PATH);
  if (!tokens) {
    deleteJsonFile(LEGACY_TOKENS_PATH);
    return;
  }

  ensureAccountsDir();

  try {
    const client = createOAuth2Client();
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    if (email) {
      writeJsonFile(path.join(ACCOUNTS_DIR, `${email}.json`), tokens);
    } else {
      writeJsonFile(path.join(ACCOUNTS_DIR, "unknown-account.json"), tokens);
    }
  } catch {
    // If we can't reach Google (offline, expired), just move with a fallback name
    writeJsonFile(path.join(ACCOUNTS_DIR, "migrated-account.json"), tokens);
  }

  deleteJsonFile(LEGACY_TOKENS_PATH);
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
): Promise<string> {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  const { tokens } = await client.getToken(code);

  // Determine the email address for this account
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  if (!email) throw new Error("Google returned no email address");

  ensureAccountsDir();
  writeJsonFile(path.join(ACCOUNTS_DIR, `${email}.json`), tokens);

  return email;
}

export async function getClient(
  email?: string,
): Promise<Auth.OAuth2Client | null> {
  await migrateLegacyTokens();

  const files = getAccountFiles();
  if (files.length === 0) return null;

  let tokenFile: string | undefined;
  if (email) {
    tokenFile = files.find((f) => path.basename(f, ".json") === email);
    if (!tokenFile) return null;
  } else {
    tokenFile = files[0];
  }

  const tokens = readJsonFile<GoogleTokens>(tokenFile);
  if (!tokens) return null;

  const client = createOAuth2Client();
  client.setCredentials(tokens);

  client.on("tokens", (newTokens) => {
    const current = readJsonFile<GoogleTokens>(tokenFile) ?? {};
    writeJsonFile(tokenFile, { ...current, ...newTokens });
  });

  return client;
}

export async function getClients(): Promise<
  Array<{ email: string; client: Auth.OAuth2Client }>
> {
  await migrateLegacyTokens();

  const files = getAccountFiles();
  const results: Array<{ email: string; client: Auth.OAuth2Client }> = [];

  for (const file of files) {
    const tokens = readJsonFile<GoogleTokens>(file);
    if (!tokens) continue;

    const email = path.basename(file, ".json");
    const client = createOAuth2Client();
    client.setCredentials(tokens);

    client.on("tokens", (newTokens) => {
      const current = readJsonFile<GoogleTokens>(file) ?? {};
      writeJsonFile(file, { ...current, ...newTokens });
    });

    results.push({ email, client });
  }

  return results;
}

export function isConnected(): boolean {
  // Check for legacy file first (will be migrated on next getClient/getClients call)
  if (fs.existsSync(LEGACY_TOKENS_PATH)) return true;

  const files = getAccountFiles();
  return files.length > 0;
}

export function getConnectedAccounts(): string[] {
  const files = getAccountFiles();
  return files.map((f) => path.basename(f, ".json"));
}

export async function getAuthStatus(): Promise<GoogleAuthStatus> {
  await migrateLegacyTokens();

  const files = getAccountFiles();
  if (files.length === 0) {
    return { connected: false, accounts: [] };
  }

  const accounts: Array<{ email: string; expiresAt?: string }> = [];
  for (const file of files) {
    const tokens = readJsonFile<GoogleTokens>(file);
    if (!tokens) continue;
    const email = path.basename(file, ".json");
    accounts.push({
      email,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
    });
  }

  return {
    connected: accounts.length > 0,
    accounts,
  };
}

export function disconnect(email?: string): void {
  if (email) {
    // Validate against known account files to prevent path traversal
    const files = getAccountFiles();
    const match = files.find((f) => path.basename(f, ".json") === email);
    if (match) deleteJsonFile(match);
  } else {
    const files = getAccountFiles();
    for (const file of files) {
      deleteJsonFile(file);
    }
  }
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const clients = await getClients();
  if (clients.length === 0) return [];

  // Fetch from all accounts in parallel
  const allResults = await Promise.all(
    clients.map(async ({ email, client }) => {
      try {
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
          accountEmail: email,
          createdAt: event.created || new Date().toISOString(),
          updatedAt: event.updated || new Date().toISOString(),
        }));
      } catch (error: any) {
        console.error(
          `[listEvents] Error fetching from ${email}:`,
          error.message,
        );
        return [];
      }
    }),
  );

  return allResults.flat();
}

export async function createEvent(
  event: CalendarEvent,
): Promise<string | undefined> {
  const client = await getClient(event.accountEmail);
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
  const client = await getClient(event.accountEmail);
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

export async function deleteEvent(
  googleEventId: string,
  accountEmail?: string,
): Promise<void> {
  const client = await getClient(accountEmail);
  if (!client) return;

  const calendar = google.calendar({ version: "v3", auth: client });
  await calendar.events.delete({
    calendarId: "primary",
    eventId: googleEventId,
  });
}
