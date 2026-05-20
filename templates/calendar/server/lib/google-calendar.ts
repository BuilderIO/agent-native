import type {
  CalendarEvent,
  GoogleAuthStatus,
  UpdateEventScope,
} from "../../shared/api.js";
import { getGoogleEventColorHex } from "../../shared/google-event-colors.js";
import {
  getOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
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
  peopleGetProfile,
} from "./google-api.js";
import {
  alignSeriesRecurrenceToStart,
  shiftSeriesDateValue,
} from "./series-recurrence.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
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
  photoUrl?: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
 * Permanent OAuth refresh failures Google can return. When we hit one of
 * these, the refresh_token is dead — keeping the row around makes
 * `getAuthStatus` lie ("connected": true) and event fetches return an
 * empty list (no clients, no surfaced errors). Drop the row so the UI
 * shows the "Connect Google" banner instead of an empty calendar.
 *
 * Causes we've seen:
 * - `invalid_grant`: user revoked access, password changed, or token aged out
 * - `unauthorized_client`: the app's GOOGLE_CLIENT_ID was rotated in env;
 *   tokens issued by the old client cannot be refreshed by the new one
 * - `invalid_client`: client_id/secret mismatch
 */
const PERMANENT_REFRESH_ERRORS = [
  "invalid_grant",
  "unauthorized_client",
  "invalid_client",
];

function createGoogleMeetRequest() {
  return {
    createRequest: {
      requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conferenceSolutionKey: { type: "hangoutsMeet" },
    },
  };
}

function mapConferenceData(data: any): CalendarEvent["conferenceData"] {
  if (!data) return undefined;
  return {
    entryPoints: data.entryPoints?.map((ep: any) => ({
      entryPointType: ep.entryPointType,
      uri: ep.uri,
      label: ep.label || undefined,
      pin: ep.pin || undefined,
      passcode: ep.passcode || undefined,
    })),
    conferenceSolution: data.conferenceSolution
      ? {
          name: data.conferenceSolution.name,
          iconUri: data.conferenceSolution.iconUri || undefined,
        }
      : undefined,
  };
}

const LIST_EVENT_TYPES = [
  "default",
  "focusTime",
  "outOfOffice",
  "workingLocation",
];

function mapReminders(
  event: any,
): Pick<CalendarEvent, "reminders" | "remindersUseDefault"> {
  return {
    remindersUseDefault: event.reminders?.useDefault ?? true,
    reminders: event.reminders?.overrides?.map((r: any) => ({
      method: r.method,
      minutes: r.minutes,
    })),
  };
}

function mapAttachments(event: any): CalendarEvent["attachments"] {
  return event.attachments?.map((attachment: any) => ({
    fileUrl: attachment.fileUrl,
    title: attachment.title || "Untitled",
    mimeType: attachment.mimeType || undefined,
    iconLink: attachment.iconLink || undefined,
    fileId: attachment.fileId || undefined,
  }));
}

function mapColor(event: any): Pick<CalendarEvent, "color" | "colorId"> {
  return {
    colorId: event.colorId || undefined,
    color: getGoogleEventColorHex(event.colorId),
  };
}

function buildDateRange(event: CalendarEvent | Partial<CalendarEvent>) {
  return {
    start: event.allDay
      ? { date: event.start?.split("T")[0] }
      : {
          dateTime: event.start,
          ...(event.startTimeZone ? { timeZone: event.startTimeZone } : {}),
        },
    end: event.allDay
      ? { date: event.end?.split("T")[0] }
      : {
          dateTime: event.end,
          ...(event.endTimeZone ? { timeZone: event.endTimeZone } : {}),
        },
  };
}

function googleEventStartValue(event: any): string | undefined {
  return event.start?.dateTime || event.start?.date || undefined;
}

function googleEventEndValue(event: any): string | undefined {
  return event.end?.dateTime || event.end?.date || undefined;
}

function alignSeriesUpdateToMaster(
  event: Partial<CalendarEvent>,
  instance: any,
  master: any,
): Partial<CalendarEvent> {
  const aligned: Partial<CalendarEvent> = { ...event };
  if (event.start !== undefined) {
    aligned.start = shiftSeriesDateValue(
      event.start,
      googleEventStartValue(instance),
      googleEventStartValue(master),
    );
    if (event.startTimeZone === undefined && master.start?.timeZone) {
      aligned.startTimeZone = master.start.timeZone;
    }
  }
  if (event.end !== undefined) {
    aligned.end = shiftSeriesDateValue(
      event.end,
      googleEventEndValue(instance),
      googleEventEndValue(master),
    );
    if (event.endTimeZone === undefined && master.end?.timeZone) {
      aligned.endTimeZone = master.end.timeZone;
    }
  }
  return aligned;
}

function applyEventOptions(body: any, event: CalendarEvent): void {
  if (event.eventType && event.eventType !== "default") {
    body.eventType = event.eventType;
  }
  if (event.transparency !== undefined) body.transparency = event.transparency;
  if (event.visibility !== undefined) body.visibility = event.visibility;
  if (event.status !== undefined) body.status = event.status;
  if (event.colorId !== undefined) body.colorId = event.colorId;
  if (event.remindersUseDefault !== undefined) {
    body.reminders = event.remindersUseDefault
      ? { useDefault: true }
      : { useDefault: false, overrides: event.reminders ?? [] };
  } else if (event.reminders !== undefined) {
    body.reminders = { useDefault: false, overrides: event.reminders };
  }

  if (event.eventType === "outOfOffice") {
    body.outOfOfficeProperties = event.outOfOfficeProperties ?? {
      autoDeclineMode: "declineNone",
    };
    body.transparency = "opaque";
  }
  if (event.eventType === "focusTime") {
    body.focusTimeProperties = event.focusTimeProperties ?? {
      autoDeclineMode: "declineNone",
      chatStatus: "doNotDisturb",
    };
    body.transparency = "opaque";
  }
  if (event.eventType === "workingLocation") {
    body.workingLocationProperties = event.workingLocationProperties ?? {
      type: "customLocation",
      customLocation: {
        label: event.location || event.title || "Working location",
      },
    };
    body.visibility = "public";
    body.transparency = "transparent";
  }
}

function applyEventPatchOptions(
  body: any,
  event: Partial<CalendarEvent>,
): void {
  if (event.transparency !== undefined) body.transparency = event.transparency;
  if (event.visibility !== undefined) body.visibility = event.visibility;
  if (event.status !== undefined) body.status = event.status;
  if (event.colorId !== undefined) body.colorId = event.colorId;
  if (event.remindersUseDefault !== undefined) {
    body.reminders = event.remindersUseDefault
      ? { useDefault: true }
      : { useDefault: false, overrides: event.reminders ?? [] };
  } else if (event.reminders !== undefined) {
    body.reminders = { useDefault: false, overrides: event.reminders };
  }
  if (event.outOfOfficeProperties !== undefined) {
    body.outOfOfficeProperties = event.outOfOfficeProperties;
  }
  if (event.focusTimeProperties !== undefined) {
    body.focusTimeProperties = event.focusTimeProperties;
  }
  if (event.workingLocationProperties !== undefined) {
    body.workingLocationProperties = event.workingLocationProperties;
  }
}

function isPermanentRefreshError(message: string): boolean {
  const m = message.toLowerCase();
  return PERMANENT_REFRESH_ERRORS.some((code) => m.includes(code));
}

/**
 * Get a valid access token for a Google account, refreshing if expired.
 *
 * Throws on refresh failure rather than returning a stale token. Callers
 * that aggregate across accounts should catch and translate to a per-
 * account error so UIs can prompt a reconnect instead of silently
 * showing empty results.
 */
async function getValidAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
): Promise<string> {
  // Check if token is expired (with 5-minute buffer)
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
    if (!tokens.refresh_token) {
      // No refresh token means we can never recover this account; drop it
      // so the UI prompts a reconnect instead of using an expired token.
      await deleteOAuthTokens("google", accountId);
      throw new Error(
        `No refresh token available for ${accountId} — please reconnect.`,
      );
    }
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
    } catch (err: any) {
      if (isPermanentRefreshError(err?.message || "")) {
        // Drop the dead row so isOAuthConnected returns false and the UI
        // surfaces the connect banner instead of a stale-token illusion.
        await deleteOAuthTokens("google", accountId);
        throw err;
      }
      // Transient failure (network hiccup, 5xx, timeout). If the existing
      // token hasn't actually expired yet — we only entered this path
      // because we're inside the 5-minute pre-expiry buffer — fall back to
      // it so a flaky moment doesn't 502 the calendar.
      if (tokens.access_token && tokens.expiry_date > Date.now()) {
        return tokens.access_token;
      }
      throw err;
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
  const photoUrl = optionalString(userInfo.picture);

  await saveOAuthTokens(
    "google",
    email,
    { ...tokens, ...(photoUrl ? { photoUrl } : {}) } as Record<string, unknown>,
    owner ?? email,
  );

  return email;
}

async function resolveAccountPhotoUrl(
  accessToken: string,
  cachedPhotoUrl?: string,
): Promise<string | undefined> {
  if (cachedPhotoUrl) return cachedPhotoUrl;

  try {
    const userInfo = await oauth2GetUserInfo(accessToken);
    const picture = optionalString(userInfo.picture);
    if (picture) return picture;
  } catch {
    // Fall back to People API below; some older tokens only carry product scopes.
  }

  try {
    const profile = await peopleGetProfile(accessToken, "photos");
    const photo =
      profile.photos?.find((p: any) => p?.url && !p.default)?.url ??
      profile.photos?.[0]?.url;
    return optionalString(photo);
  } catch {
    return undefined;
  }
}

export async function getClient(
  email: string | undefined,
): Promise<{ accessToken: string } | null> {
  if (!email) return null;
  const accounts = await listOAuthAccountsByOwner("google", email);
  if (accounts.length === 0) return null;

  const account = accounts.find((a) => a.accountId === email) ?? accounts[0];

  const tokens = account.tokens as unknown as GoogleTokens;
  const accessToken = await getValidAccessToken(
    account.accountId,
    tokens,
    email,
  );
  return { accessToken };
}

/**
 * Get OAuth credentials. When `forEmail` is provided, returns only that
 * user's credentials (multi-user mode). Otherwise returns an empty array.
 *
 * Refresh failures are swallowed per-account — the signature preserves
 * the "empty array means no usable client" contract that existing
 * callers rely on for graceful "no Google account connected" fallbacks.
 * Callers that need to surface "all your tokens are dead" to the UI
 * should use `getClientsWithErrors` directly (already wired into
 * `listEvents` and `listOverlayEvents`).
 */
export async function getClients(
  forEmail?: string,
): Promise<Array<{ email: string; accessToken: string }>> {
  const { clients } = await getClientsWithErrors(forEmail);
  return clients;
}

/**
 * Same as `getClients`, but also returns per-account refresh errors so
 * callers can distinguish "no accounts connected" (empty errors) from
 * "all accounts failed to refresh" (errors populated). Event fetches use
 * this to return a 502 with the underlying reason instead of silently
 * rendering an empty calendar.
 */
export async function getClientsWithErrors(forEmail?: string): Promise<{
  clients: Array<{ email: string; accessToken: string }>;
  errors: Array<{ email: string; error: string }>;
}> {
  if (!forEmail) return { clients: [], errors: [] };
  const accounts = await listOAuthAccountsByOwner("google", forEmail);

  const clients: Array<{ email: string; accessToken: string }> = [];
  const errors: Array<{ email: string; error: string }> = [];

  for (const account of accounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    const owner =
      forEmail ??
      ("owner" in account && typeof account.owner === "string"
        ? account.owner
        : undefined) ??
      account.accountId;
    try {
      const accessToken = await getValidAccessToken(
        account.accountId,
        tokens,
        owner,
      );
      clients.push({ email: account.accountId, accessToken });
    } catch (err: any) {
      errors.push({
        email: account.accountId,
        error: err?.message || "Unknown refresh error",
      });
    }
  }

  return { clients, errors };
}

export async function isConnected(forEmail?: string): Promise<boolean> {
  return isOAuthConnected("google", forEmail);
}

export async function getConnectedAccounts(
  forEmail?: string,
): Promise<string[]> {
  if (!forEmail) return [];
  const accounts = await listOAuthAccountsByOwner("google", forEmail);
  return accounts.map((a) => a.accountId);
}

export async function getAuthStatus(
  forEmail?: string,
): Promise<GoogleAuthStatus> {
  const oauthAccounts = await getOAuthAccounts("google", forEmail);

  if (oauthAccounts.length === 0) {
    return { connected: false, accounts: [] };
  }

  const result: Array<{
    email: string;
    expiresAt?: string;
    photoUrl?: string;
  }> = [];
  for (const account of oauthAccounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    let photoUrl = optionalString(tokens.photoUrl);
    let tokenValid = false;
    try {
      const accessToken = await getValidAccessToken(
        account.accountId,
        tokens,
        forEmail,
      );
      tokenValid = true;
      photoUrl = await resolveAccountPhotoUrl(accessToken, photoUrl);
    } catch {
      // getValidAccessToken throws when the refresh token is permanently
      // revoked (after deleting the broken row). Excluding the account here
      // ensures `connected` flips to false instead of reporting a dead
      // account as still connected.
    }
    if (!tokenValid) continue;
    result.push({
      email: account.accountId,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
      photoUrl,
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
  const { clients, errors: refreshErrors } =
    await getClientsWithErrors(forEmail);
  // Seed with refresh failures so a fully-dead connection (every account's
  // refresh_token revoked or invalidated by a GOOGLE_CLIENT_ID rotation)
  // reaches the caller — otherwise the result is indistinguishable from
  // "calendar is empty" and the user sees no error.
  const errors: Array<{ email: string; error: string }> = [...refreshErrors];
  if (clients.length === 0) return { events: [], errors };

  const allResults = await Promise.all(
    clients.map(async ({ email, accessToken }) => {
      try {
        const response = await calendarListEvents(accessToken, "primary", {
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          eventTypes: LIST_EVENT_TYPES,
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
            startTimeZone: event.start?.timeZone || undefined,
            endTimeZone: event.end?.timeZone || undefined,
            location: event.location || "",
            allDay: !event.start?.dateTime,
            source: "google" as const,
            googleEventId: event.id || undefined,
            htmlLink: event.htmlLink || undefined,
            accountEmail: email,
            responseStatus: selfAttendee?.responseStatus,
            transparency: event.transparency || undefined,
            ...mapColor(event),
            eventType: event.eventType || "default",
            attendees: event.attendees?.map((a: any) => ({
              email: a.email,
              displayName: a.displayName || undefined,
              photoUrl: a.photoUrl || undefined,
              responseStatus: a.responseStatus || undefined,
              organizer: a.organizer || undefined,
              self: a.self || undefined,
            })),
            ...mapReminders(event),
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
            attachments: mapAttachments(event),
            visibility: event.visibility || undefined,
            status: event.status || undefined,
            outOfOfficeProperties: event.outOfOfficeProperties || undefined,
            focusTimeProperties: event.focusTimeProperties || undefined,
            workingLocationProperties:
              event.workingLocationProperties || undefined,
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
  const { clients, errors: refreshErrors } =
    await getClientsWithErrors(forEmail);
  const errors: Array<{ email: string; error: string }> = [...refreshErrors];
  if (clients.length === 0) return { events: [], errors };

  // Use the first available token to query other people's calendars
  const { accessToken } = clients[0];

  const allResults = await Promise.all(
    overlayEmails.map(async (overlayEmail) => {
      try {
        const response = await calendarListEvents(accessToken, overlayEmail, {
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          eventTypes: LIST_EVENT_TYPES,
        });

        const events = response.items || [];
        return events.map((event: any) => ({
          id: `overlay-${overlayEmail}-${event.id}`,
          title: event.summary || "Busy",
          description: event.description || "",
          start: event.start?.dateTime || event.start?.date || "",
          end: event.end?.dateTime || event.end?.date || "",
          startTimeZone: event.start?.timeZone || undefined,
          endTimeZone: event.end?.timeZone || undefined,
          location: event.location || "",
          allDay: !event.start?.dateTime,
          source: "google" as const,
          googleEventId: event.id || undefined,
          htmlLink: event.htmlLink || undefined,
          eventType: event.eventType || "default",
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

export async function getEvent(
  googleEventId: string,
  accountEmail: string,
): Promise<CalendarEvent> {
  const client = await getClient(accountEmail);
  if (!client) {
    throw new Error(
      `Google Calendar account not connected: ${accountEmail || "selected account"}`,
    );
  }

  const event = await calendarGetEvent(
    client.accessToken,
    "primary",
    googleEventId,
  );
  const selfAttendee = event.attendees?.find((a: any) => a.self === true);

  return {
    id: `google-${event.id}`,
    title: event.summary || "Untitled",
    description: event.description || "",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    startTimeZone: event.start?.timeZone || undefined,
    endTimeZone: event.end?.timeZone || undefined,
    location: event.location || "",
    allDay: !event.start?.dateTime,
    source: "google",
    googleEventId: event.id || undefined,
    htmlLink: event.htmlLink || undefined,
    accountEmail,
    responseStatus: selfAttendee?.responseStatus || undefined,
    transparency: event.transparency || undefined,
    ...mapColor(event),
    eventType: event.eventType || "default",
    attendees: event.attendees?.map((a: any) => ({
      email: a.email,
      displayName: a.displayName || undefined,
      photoUrl: a.photoUrl || undefined,
      responseStatus: a.responseStatus || undefined,
      organizer: a.organizer || undefined,
      self: a.self || undefined,
    })),
    ...mapReminders(event),
    recurrence: event.recurrence || undefined,
    recurringEventId: event.recurringEventId || undefined,
    hangoutLink: event.hangoutLink || undefined,
    conferenceData: mapConferenceData(event.conferenceData),
    attachments: mapAttachments(event),
    visibility: event.visibility || undefined,
    status: event.status || undefined,
    outOfOfficeProperties: event.outOfOfficeProperties || undefined,
    focusTimeProperties: event.focusTimeProperties || undefined,
    workingLocationProperties: event.workingLocationProperties || undefined,
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
}

export async function createEvent(
  event: CalendarEvent,
  opts?: {
    addGoogleMeet?: boolean;
    sendUpdates?: "all" | "externalOnly" | "none";
  },
): Promise<{
  id?: string;
  htmlLink?: string;
  meetLink?: string;
  conferenceData?: CalendarEvent["conferenceData"];
}> {
  const client = await getClient(event.accountEmail);
  if (!client) return {};
  if (
    (event.eventType === "outOfOffice" || event.eventType === "focusTime") &&
    event.allDay
  ) {
    throw new Error("Out of office and focus time events must be timed.");
  }

  const body: any = {
    summary: event.title,
    description: event.description,
    location: event.location,
    ...buildDateRange(event),
  };
  applyEventOptions(body, event);
  if (event.attachments !== undefined) {
    body.attachments = event.attachments;
  }

  if (event.attendees && event.attendees.length > 0) {
    body.attendees = event.attendees.map((a) => ({
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
    }));
  }

  if (opts?.addGoogleMeet) {
    body.conferenceData = createGoogleMeetRequest();
  }

  const insertOpts: {
    conferenceDataVersion?: number;
    sendUpdates?: string;
    supportsAttachments?: boolean;
  } = {};
  if (opts?.addGoogleMeet) insertOpts.conferenceDataVersion = 1;
  if (opts?.sendUpdates) insertOpts.sendUpdates = opts.sendUpdates;
  if (event.attachments !== undefined) insertOpts.supportsAttachments = true;

  const response = await calendarInsertEvent(
    client.accessToken,
    "primary",
    body,
    Object.keys(insertOpts).length > 0 ? insertOpts : undefined,
  );

  return {
    id: response.id || undefined,
    htmlLink: response.htmlLink || undefined,
    meetLink: response.hangoutLink || undefined,
    conferenceData: mapConferenceData(response.conferenceData),
  };
}

export async function updateEvent(
  googleEventId: string,
  event: Partial<CalendarEvent>,
  options?: {
    sendUpdates?: "all" | "none";
    addGoogleMeet?: boolean;
    scope?: UpdateEventScope;
  },
): Promise<{
  htmlLink?: string;
  meetLink?: string;
  conferenceData?: CalendarEvent["conferenceData"];
}> {
  const client = await getClient(event.accountEmail);
  if (!client) {
    throw new Error(
      `Google Calendar account not connected: ${event.accountEmail ?? "selected account"}`,
    );
  }

  let targetEventId = googleEventId;
  let eventPatch = event;
  if (options?.scope === "all") {
    const instance = await calendarGetEvent(
      client.accessToken,
      "primary",
      googleEventId,
    );
    const recurringEventId = instance.recurringEventId || googleEventId;
    targetEventId = recurringEventId;
    let master = instance;
    if (recurringEventId !== googleEventId) {
      master = await calendarGetEvent(
        client.accessToken,
        "primary",
        recurringEventId,
      );
      eventPatch = alignSeriesUpdateToMaster(event, instance, master);
    }
    eventPatch = alignSeriesRecurrenceToStart(eventPatch, {
      startValue: googleEventStartValue(master),
      startTimeZone: master.start?.timeZone,
      recurrence: master.recurrence,
    });
  }

  const requestBody: any = {};
  if (eventPatch.title !== undefined) requestBody.summary = eventPatch.title;
  if (eventPatch.description !== undefined)
    requestBody.description = eventPatch.description;
  if (eventPatch.location !== undefined)
    requestBody.location = eventPatch.location;
  if (eventPatch.start !== undefined) {
    requestBody.start = eventPatch.allDay
      ? { date: eventPatch.start.split("T")[0] }
      : {
          dateTime: eventPatch.start,
          ...(eventPatch.startTimeZone
            ? { timeZone: eventPatch.startTimeZone }
            : {}),
        };
  }
  if (eventPatch.end !== undefined) {
    requestBody.end = eventPatch.allDay
      ? { date: eventPatch.end.split("T")[0] }
      : {
          dateTime: eventPatch.end,
          ...(eventPatch.endTimeZone
            ? { timeZone: eventPatch.endTimeZone }
            : {}),
        };
  }
  if (eventPatch.attendees !== undefined) {
    requestBody.attendees = eventPatch.attendees.map((a) => ({
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
    }));
  }
  if (eventPatch.recurrence !== undefined) {
    requestBody.recurrence = eventPatch.recurrence;
  }
  if (eventPatch.attachments !== undefined) {
    requestBody.attachments = eventPatch.attachments;
  }
  applyEventPatchOptions(requestBody, eventPatch);
  if (options?.addGoogleMeet) {
    requestBody.conferenceData = createGoogleMeetRequest();
  }

  const response = await calendarPatchEvent(
    client.accessToken,
    "primary",
    targetEventId,
    requestBody,
    {
      sendUpdates: options?.sendUpdates,
      conferenceDataVersion: options?.addGoogleMeet ? 1 : undefined,
      supportsAttachments:
        eventPatch.attachments !== undefined ? true : undefined,
    },
  );

  return {
    htmlLink: response?.htmlLink || undefined,
    meetLink: response?.hangoutLink || undefined,
    conferenceData: mapConferenceData(response?.conferenceData),
  };
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
  if (!client) {
    throw new Error(
      `Google Calendar account not connected: ${accountEmail ?? "selected account"}`,
    );
  }

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
    { sendUpdates },
  );
}

/**
 * Remove an event from the current user's calendar without deleting it for others.
 * Calls the DELETE API endpoint which removes it from this user's calendar view
 * without cancelling or affecting other attendees.
 */
export async function removeEventFromCalendar(
  googleEventId: string,
  accountEmail: string,
  options?: {
    scope?: "single" | "all" | "thisAndFollowing";
    sendUpdates?: "all" | "none";
  },
): Promise<void> {
  const client = await getClient(accountEmail);
  if (!client) {
    throw new Error(`Google Calendar account not connected: ${accountEmail}`);
  }

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

  // For "all" or "thisAndFollowing", find the base recurring event
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

  // "thisAndFollowing" — delete each instance from this one onward
  // For non-organizers we can only delete instance by instance; delete this one
  await calendarDeleteEvent(
    client.accessToken,
    "primary",
    googleEventId,
    sendUpdates,
  );
}

/** RSVP a single event instance without overwriting the full attendee list. */
async function rsvpSingleEvent(
  accessToken: string,
  eventId: string,
  responseStatus: string,
  accountEmail: string,
  sendUpdates?: string,
): Promise<void> {
  await calendarPatchEvent(
    accessToken,
    "primary",
    eventId,
    {
      attendees: [{ email: accountEmail, responseStatus }],
      attendeesOmitted: true,
    },
    { sendUpdates: sendUpdates ?? "none" },
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
  if (!client) {
    throw new Error(`Google Calendar account not connected: ${accountEmail}`);
  }

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
