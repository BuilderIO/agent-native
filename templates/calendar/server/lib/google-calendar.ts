import type { CalendarEvent, GoogleAuthStatus } from "../../shared/api.js";
import {
  getOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  hasOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { isOAuthConnected, getOAuthAccounts } from "@agent-native/core/server";
import {
  createOAuth2Client,
  oauth2GetUserInfo,
  calendarListEvents,
  calendarGetEvent,
  calendarInsertEvent,
  calendarDeleteEvent,
  calendarPatchEvent,
} from "./google-api.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/directory.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function getOAuth2Credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Get a valid access token for a Google account, refreshing if expired.
 */
async function getValidAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
): Promise<string> {
  // Check if token is expired (with 5-minute buffer)
  if (
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000 &&
    tokens.refresh_token
  ) {
    try {
      const { clientId, clientSecret } = getOAuth2Credentials();
      const oauth2 = createOAuth2Client(clientId, clientSecret, "");
      const newTokens = await oauth2.refreshToken(tokens.refresh_token);
      const merged = { ...tokens, ...newTokens };
      await saveOAuthTokens(
        "google",
        accountId,
        merged as unknown as Record<string, unknown>,
        owner ?? accountId,
      );
      return merged.access_token;
    } catch {
      // Refresh failed — use existing token
    }
  }
  return tokens.access_token;
}

export function getAuthUrl(
  origin?: string,
  redirectUri?: string,
  state?: string,
): string {
  const { clientId, clientSecret } = getOAuth2Credentials();
  const uri =
    redirectUri ||
    (origin ? `${origin}/_agent-native/google/callback` : undefined);
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri ?? "");
  return oauth2.generateAuthUrl({
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
  const { clientId, clientSecret } = getOAuth2Credentials();
  const uri =
    redirectUri ||
    (origin ? `${origin}/_agent-native/google/callback` : undefined);
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri ?? "");
  const tokens = await oauth2.getToken(code);

  // Get user email
  const userInfo = await oauth2GetUserInfo(tokens.access_token);
  const email = userInfo.email;
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
): Promise<{ accessToken: string } | null> {
  const accounts = await listOAuthAccounts("google");
  if (accounts.length === 0) return null;

  let account: (typeof accounts)[number] | undefined;
  if (email) {
    account =
      accounts.find((a) => a.accountId === email) ??
      accounts.find((a) => a.owner === email);
    if (!account) return null;
  } else {
    account = accounts[0];
  }

  const tokens = account.tokens as unknown as GoogleTokens;
  const accessToken = await getValidAccessToken(
    account.accountId,
    tokens,
    account.owner ?? account.accountId,
  );
  return { accessToken };
}

export async function getClients(
  forEmail?: string,
): Promise<Array<{ email: string; accessToken: string }>> {
  const accounts = forEmail
    ? await listOAuthAccountsByOwner("google", forEmail)
    : await listOAuthAccounts("google");

  const results: Array<{ email: string; accessToken: string }> = [];

  for (const account of accounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    const owner =
      forEmail ??
      ("owner" in account && typeof account.owner === "string"
        ? account.owner
        : undefined) ??
      account.accountId;
    const accessToken = await getValidAccessToken(
      account.accountId,
      tokens,
      owner,
    );
    results.push({ email: account.accountId, accessToken });
  }

  return results;
}

export async function isConnected(forEmail?: string): Promise<boolean> {
  return isOAuthConnected("google", forEmail);
}

export async function getConnectedAccounts(): Promise<string[]> {
  const accounts = await listOAuthAccounts("google");
  return accounts.map((a) => a.accountId);
}

export async function getAuthStatus(
  forEmail?: string,
): Promise<GoogleAuthStatus> {
  const oauthAccounts = await getOAuthAccounts("google", forEmail);

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
    clients.map(async ({ email, accessToken }) => {
      try {
        const response = await calendarListEvents(accessToken, "primary", {
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
        });

        const events = response.items || [];
        return events.map((event: any) => {
          // Find the current user's RSVP status from attendees
          const selfAttendee = event.attendees?.find(
            (a: any) => a.self === true,
          );
          return {
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
            responseStatus: selfAttendee?.responseStatus,
            attendees: event.attendees?.map((a: any) => ({
              email: a.email,
              displayName: a.displayName || undefined,
              photoUrl: a.photoUrl || undefined,
              responseStatus: a.responseStatus || undefined,
              organizer: a.organizer || undefined,
              self: a.self || undefined,
            })),
            reminders: event.reminders?.overrides?.map((r: any) => ({
              method: r.method,
              minutes: r.minutes,
            })),
            recurrence: event.recurrence || undefined,
            recurringEventId: event.recurringEventId || undefined,
            hangoutLink: event.hangoutLink || undefined,
            conferenceData: event.conferenceData
              ? {
                  entryPoints: event.conferenceData.entryPoints?.map(
                    (ep: any) => ({
                      entryPointType: ep.entryPointType,
                      uri: ep.uri,
                      label: ep.label || undefined,
                      pin: ep.pin || undefined,
                      passcode: ep.passcode || undefined,
                    }),
                  ),
                  conferenceSolution: event.conferenceData.conferenceSolution
                    ? {
                        name: event.conferenceData.conferenceSolution.name,
                        iconUri:
                          event.conferenceData.conferenceSolution.iconUri ||
                          undefined,
                      }
                    : undefined,
                }
              : undefined,
            visibility: event.visibility || undefined,
            status: event.status || undefined,
            organizer: event.organizer
              ? {
                  email: event.organizer.email,
                  displayName: event.organizer.displayName || undefined,
                  self: event.organizer.self || undefined,
                }
              : undefined,
            createdAt: event.created || new Date().toISOString(),
            updatedAt: event.updated || new Date().toISOString(),
          };
        });
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

export async function listOverlayEvents(
  timeMin: string,
  timeMax: string,
  overlayEmails: string[],
  forEmail?: string,
): Promise<{
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string }>;
}> {
  const clients = await getClients(forEmail);
  if (clients.length === 0) return { events: [], errors: [] };

  // Use the first available token to query other people's calendars
  const { accessToken } = clients[0];
  const errors: Array<{ email: string; error: string }> = [];

  const allResults = await Promise.all(
    overlayEmails.map(async (overlayEmail) => {
      try {
        const response = await calendarListEvents(accessToken, overlayEmail, {
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
        });

        const events = response.items || [];
        return events.map((event: any) => ({
          id: `overlay-${overlayEmail}-${event.id}`,
          title: event.summary || "Busy",
          description: event.description || "",
          start: event.start?.dateTime || event.start?.date || "",
          end: event.end?.dateTime || event.end?.date || "",
          location: event.location || "",
          allDay: !event.start?.dateTime,
          source: "google" as const,
          googleEventId: event.id || undefined,
          accountEmail: undefined,
          overlayEmail,
          createdAt: event.created || new Date().toISOString(),
          updatedAt: event.updated || new Date().toISOString(),
        }));
      } catch (error: any) {
        console.error(
          `[listOverlayEvents] Error fetching ${overlayEmail}:`,
          error.message,
        );
        errors.push({ email: overlayEmail, error: error.message });
        return [];
      }
    }),
  );

  return { events: allResults.flat(), errors };
}

export async function createEvent(
  event: CalendarEvent,
  opts?: { addGoogleMeet?: boolean },
): Promise<{ id?: string; meetLink?: string }> {
  const client = await getClient(event.accountEmail);
  if (!client) return {};

  const body: any = {
    summary: event.title,
    description: event.description,
    location: event.location,
    start: event.allDay
      ? { date: event.start.split("T")[0] }
      : { dateTime: event.start },
    end: event.allDay
      ? { date: event.end.split("T")[0] }
      : { dateTime: event.end },
  };

  if (opts?.addGoogleMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const response = await calendarInsertEvent(
    client.accessToken,
    "primary",
    body,
    opts?.addGoogleMeet ? { conferenceDataVersion: 1 } : undefined,
  );

  return {
    id: response.id || undefined,
    meetLink: response.hangoutLink || undefined,
  };
}

export async function updateEvent(
  googleEventId: string,
  event: Partial<CalendarEvent>,
): Promise<void> {
  const client = await getClient(event.accountEmail);
  if (!client) return;

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

  await calendarPatchEvent(
    client.accessToken,
    "primary",
    googleEventId,
    requestBody,
  );
}

export async function deleteEvent(
  googleEventId: string,
  accountEmail?: string,
  options?: {
    scope?: "single" | "all" | "thisAndFollowing";
    sendUpdates?: "all" | "none";
  },
): Promise<void> {
  const client = await getClient(accountEmail);
  if (!client) return;

  const scope = options?.scope || "single";
  const sendUpdates = options?.sendUpdates;

  if (scope === "single") {
    await calendarDeleteEvent(
      client.accessToken,
      "primary",
      googleEventId,
      sendUpdates,
    );
    return;
  }

  // For "all" or "thisAndFollowing", find the master recurring event
  const instance = await calendarGetEvent(
    client.accessToken,
    "primary",
    googleEventId,
  );
  const recurringEventId = instance.recurringEventId || googleEventId;

  if (scope === "all") {
    await calendarDeleteEvent(
      client.accessToken,
      "primary",
      recurringEventId,
      sendUpdates,
    );
    return;
  }

  // "thisAndFollowing" — truncate the recurrence rule on the master event
  if (recurringEventId === googleEventId) {
    // This IS the master event, just delete the whole series
    await calendarDeleteEvent(
      client.accessToken,
      "primary",
      googleEventId,
      sendUpdates,
    );
    return;
  }

  const instanceStart = instance.start?.dateTime || instance.start?.date || "";
  const isAllDay = !instance.start?.dateTime;

  // Compute UNTIL value (day before this instance)
  const cutoff = new Date(instanceStart);
  cutoff.setDate(cutoff.getDate() - 1);

  let untilStr: string;
  if (isAllDay) {
    // All-day: UNTIL=YYYYMMDD
    untilStr = cutoff.toISOString().slice(0, 10).replace(/-/g, "");
  } else {
    // Timed: UNTIL=YYYYMMDDTHHMMSSZ (end of the cutoff day in UTC)
    cutoff.setUTCHours(23, 59, 59, 0);
    untilStr = cutoff.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  }

  // Get the master event's recurrence rules and truncate
  const master = await calendarGetEvent(
    client.accessToken,
    "primary",
    recurringEventId,
  );
  const recurrence: string[] = master.recurrence || [];
  const updatedRecurrence = recurrence.map((rule: string) => {
    if (rule.startsWith("RRULE:")) {
      // Remove any existing UNTIL or COUNT
      let updated = rule.replace(/;(UNTIL|COUNT)=[^;]*/g, "");
      updated += `;UNTIL=${untilStr}`;
      return updated;
    }
    return rule;
  });

  await calendarPatchEvent(
    client.accessToken,
    "primary",
    recurringEventId,
    { recurrence: updatedRecurrence },
    sendUpdates,
  );
}

/**
 * Remove an event from the current user's calendar without deleting it for others.
 * This declines the event (RSVPs as "declined") which removes it from the user's
 * default calendar view.
 */
export async function removeEventFromCalendar(
  googleEventId: string,
  accountEmail: string,
  options?: {
    scope?: "single" | "all" | "thisAndFollowing";
    sendUpdates?: "all" | "none";
  },
): Promise<void> {
  const scope = options?.scope || "single";
  const sendUpdates = options?.sendUpdates;

  await rsvpEvent(googleEventId, "declined", accountEmail, scope, sendUpdates);
}

/**
 * RSVP a single event instance — fetches attendees first to avoid overwriting.
 */
async function rsvpSingleEvent(
  accessToken: string,
  eventId: string,
  responseStatus: string,
  accountEmail: string,
  sendUpdates?: string,
): Promise<void> {
  const existing = await calendarGetEvent(accessToken, "primary", eventId);
  const attendees = (existing.attendees ?? []).map(
    (a: { email: string; responseStatus?: string }) =>
      a.email === accountEmail ? { ...a, responseStatus } : a,
  );
  await calendarPatchEvent(
    accessToken,
    "primary",
    eventId,
    { attendees },
    sendUpdates ?? "none",
  );
}

/**
 * Update the current user's RSVP status for an event.
 * Supports recurring event scopes: "single", "all", or "thisAndFollowing".
 */
export async function rsvpEvent(
  googleEventId: string,
  responseStatus: "accepted" | "declined" | "tentative",
  accountEmail: string,
  scope: "single" | "all" | "thisAndFollowing" = "single",
  sendUpdates?: string,
): Promise<void> {
  const client = await getClient(accountEmail);
  if (!client) return;

  if (scope === "single") {
    await rsvpSingleEvent(
      client.accessToken,
      googleEventId,
      responseStatus,
      accountEmail,
      sendUpdates,
    );
    return;
  }

  // For "all" or "thisAndFollowing", we need the base recurring event ID.
  const instance = await calendarGetEvent(
    client.accessToken,
    "primary",
    googleEventId,
  );
  const recurringEventId = instance.recurringEventId || googleEventId;

  if (scope === "all") {
    // RSVP the base recurring event — Google propagates to all instances
    // that don't have individual overrides.
    await rsvpSingleEvent(
      client.accessToken,
      recurringEventId,
      responseStatus,
      accountEmail,
      sendUpdates,
    );
    return;
  }

  // "thisAndFollowing": RSVP this instance and all future instances.
  // Get the start time of the current instance to use as the cutoff.
  const instanceStart =
    instance.start?.dateTime ||
    instance.start?.date ||
    new Date().toISOString();

  // Fetch all future instances of this recurring event
  const futureEvents = await calendarListEvents(client.accessToken, "primary", {
    timeMin: instanceStart,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  // Filter to only instances of the same recurring series
  const futureInstances = (futureEvents.items || []).filter(
    (e: any) =>
      e.recurringEventId === recurringEventId || e.id === recurringEventId,
  );

  // RSVP each instance (including the current one)
  await Promise.all(
    futureInstances.map((e: any) =>
      rsvpSingleEvent(
        client.accessToken,
        e.id,
        responseStatus,
        accountEmail,
        sendUpdates,
      ),
    ),
  );
}
