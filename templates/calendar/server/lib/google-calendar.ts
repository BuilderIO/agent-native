import { google, type Auth } from "googleapis";
import type { CalendarEvent, GoogleAuthStatus } from "../../shared/api.js";
import {
  getOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  hasOAuthTokens,
} from "@agent-native/core/oauth-tokens";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

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

export function getAuthUrl(
  origin?: string,
  redirectUri?: string,
  state?: string,
): string {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

export async function exchangeCode(
  code: string,
  origin?: string,
  redirectUri?: string,
  owner?: string,
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

  await saveOAuthTokens(
    "google",
    email,
    tokens as Record<string, unknown>,
    owner ?? email,
  );

  return email;
}

export async function getClient(
  email?: string,
): Promise<Auth.OAuth2Client | null> {
  const accounts = await listOAuthAccounts("google");
  if (accounts.length === 0) return null;

  let account: (typeof accounts)[number] | undefined;
  if (email) {
    account = accounts.find((a) => a.accountId === email);
    if (!account) return null;
  } else {
    account = accounts[0];
  }

  const tokens = account.tokens as unknown as GoogleTokens;
  const accountId = account.accountId;

  const client = createOAuth2Client();
  client.setCredentials(tokens);

  client.on("tokens", async (newTokens) => {
    const current =
      ((await getOAuthTokens(
        "google",
        accountId,
      )) as unknown as GoogleTokens | null) ?? {};
    await saveOAuthTokens("google", accountId, {
      ...current,
      ...newTokens,
    });
  });

  return client;
}

export async function getClients(
  forEmail?: string,
): Promise<Array<{ email: string; client: Auth.OAuth2Client }>> {
  if (forEmail) {
    const accounts = await listOAuthAccountsByOwner("google", forEmail);
    const results: Array<{ email: string; client: Auth.OAuth2Client }> = [];

    for (const account of accounts) {
      const tokens = account.tokens as unknown as GoogleTokens;
      const accountId = account.accountId;

      const client = createOAuth2Client();
      client.setCredentials(tokens);

      client.on("tokens", async (newTokens) => {
        const current =
          ((await getOAuthTokens(
            "google",
            accountId,
          )) as unknown as GoogleTokens | null) ?? {};
        await saveOAuthTokens("google", accountId, {
          ...current,
          ...newTokens,
        });
      });

      results.push({ email: accountId, client });
    }

    return results;
  }

  const accounts = await listOAuthAccounts("google");
  const results: Array<{ email: string; client: Auth.OAuth2Client }> = [];

  for (const account of accounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    const accountId = account.accountId;

    const client = createOAuth2Client();
    client.setCredentials(tokens);

    client.on("tokens", async (newTokens) => {
      const current =
        ((await getOAuthTokens(
          "google",
          accountId,
        )) as unknown as GoogleTokens | null) ?? {};
      await saveOAuthTokens("google", accountId, {
        ...current,
        ...newTokens,
      });
    });

    results.push({ email: accountId, client });
  }

  return results;
}

export async function isConnected(forEmail?: string): Promise<boolean> {
  if (forEmail) {
    const accounts = await listOAuthAccountsByOwner("google", forEmail);
    return accounts.length > 0;
  }
  return hasOAuthTokens("google");
}

export async function getConnectedAccounts(): Promise<string[]> {
  const accounts = await listOAuthAccounts("google");
  return accounts.map((a) => a.accountId);
}

export async function getAuthStatus(
  forEmail?: string,
): Promise<GoogleAuthStatus> {
  let oauthAccounts: Array<{
    accountId: string;
    tokens: Record<string, unknown>;
  }>;
  if (forEmail) {
    oauthAccounts = await listOAuthAccountsByOwner("google", forEmail);
  } else {
    oauthAccounts = await listOAuthAccounts("google");
  }

  if (oauthAccounts.length === 0) {
    return { connected: false, accounts: [] };
  }

  const result: Array<{ email: string; expiresAt?: string }> = [];
  for (const account of oauthAccounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    result.push({
      email: account.accountId,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
    });
  }

  return {
    connected: result.length > 0,
    accounts: result,
  };
}

export async function disconnect(email?: string): Promise<void> {
  await deleteOAuthTokens("google", email);
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
  forEmail?: string,
): Promise<{
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string }>;
}> {
  const clients = await getClients(forEmail);
  if (clients.length === 0) return { events: [], errors: [] };

  const errors: Array<{ email: string; error: string }> = [];

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
        errors.push({ email, error: error.message });
        return [];
      }
    }),
  );

  return { events: allResults.flat(), errors };
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
