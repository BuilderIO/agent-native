import { getDbExec } from "@agent-native/core/db";
import {
  OAuthAccountOwnedByOtherUserError,
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import {
  checkSaveRevision,
  countSaveOutcome,
  isSameRecord,
  saveConflict,
} from "@agent-native/core/save-conflict/server";
import {
  getOAuthAccounts,
  getCredentialContext,
  getRequestOrgId,
  resolveSecret,
  runWithRequestContext,
  resolveGoogleProviderCredentialCandidatesWithReader,
} from "@agent-native/core/server";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";

import type {
  CalendarEvent,
  GoogleCalendarSource,
  GoogleAuthStatus,
  UpdateEventScope,
} from "../../shared/api.js";
import {
  createGoogleAccountEventId,
  createGoogleCalendarCanonicalKey,
  createGoogleCalendarSourceKey,
} from "../../shared/google-calendar-sources.js";
import { getGoogleEventColorHex } from "../../shared/google-event-colors.js";
import { isCalendarTimezone } from "../../shared/timezone.js";
import {
  createOAuth2Client,
  oauth2GetUserInfo,
  calendarListEvents,
  calendarListCalendars,
  calendarFreeBusy,
  calendarGetCalendar,
  calendarGetEvent,
  calendarInsertEvent,
  calendarDeleteEvent,
  calendarPatchEvent,
  calendarUpdateEvent,
  isGoogleEventAbsentError,
  GoogleApiError,
  isGooglePreconditionFailedError,
  peopleGetProfile,
} from "./google-api.js";
import { listSyncedGoogleEvents } from "./google-event-sync.js";
import { getCalendarProviderApiRuntime } from "./provider-api.js";
import {
  alignSeriesRecurrenceToStart,
  shiftSeriesDateValue,
} from "./series-recurrence.js";

type ManagedCalendarClient = {
  email: string;
  accessToken: string;
};

async function hasManagedCalendarConnection(): Promise<boolean> {
  if (!getCredentialContext()) return false;
  const connection = await resolveWorkspaceConnectionForApp({
    appId: "calendar",
    provider: "google_calendar",
    requireConnected: true,
  });
  return connection.available;
}

async function resolveManagedCalendarClient(): Promise<ManagedCalendarClient | null> {
  if (!(await hasManagedCalendarConnection())) return null;
  const credential =
    await getCalendarProviderApiRuntime().resolveOAuthAccessToken({
      provider: "google_calendar",
    });
  if (!credential.accountId) {
    throw new Error(
      "The connected Google Calendar workspace account has no account id.",
    );
  }
  return { email: credential.accountId, accessToken: credential.accessToken };
}

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
  photoUrl?: string;
}

const CALENDAR_SCOPE_PREFIX = "https://www.googleapis.com/auth/calendar.";

function hasCalendarScope(tokens: Record<string, unknown>): boolean {
  const scope = tokens.scope;
  if (typeof scope !== "string" || !scope.trim()) return true;
  return grantsCalendarScope(scope);
}

function grantsCalendarScope(scope: unknown): boolean {
  return (
    typeof scope === "string" &&
    scope
      .split(/[\s,]+/)
      .some((value) => value.startsWith(CALENDAR_SCOPE_PREFIX))
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function getOAuth2Credentials(owner?: string, orgId?: string) {
  const credentials = (
    await resolveGoogleProviderCredentialCandidates(owner, orgId)
  )[0];
  if (!credentials) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be saved in settings",
    );
  }
  return credentials;
}

async function getOAuth2RefreshCredentials(owner?: string, orgId?: string) {
  const candidates = await resolveGoogleProviderCredentialCandidates(
    owner,
    orgId,
  );
  if (!candidates.length) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be saved in settings",
    );
  }
  return candidates;
}

async function resolveGoogleProviderCredentialCandidates(
  owner?: string,
  orgId?: string,
) {
  const resolve = () =>
    resolveGoogleProviderCredentialCandidatesWithReader({
      readCredential: resolveSecret,
      fallbackReadCredential: (key) => process.env[key],
    });
  const resolvedOrgId = orgId ?? getRequestOrgId();
  return owner
    ? runWithRequestContext({ userEmail: owner, orgId: resolvedOrgId }, resolve)
    : await resolve();
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
const GOOGLE_READ_CONCURRENCY = 4;

export class CalendarMoveRollbackError extends Error {
  readonly code = "CALENDAR_MOVE_ROLLBACK_FAILED" as const;
  readonly cause: unknown;
  readonly replacementId: string;
  readonly destinationAccountEmail: string;

  constructor(
    replacementId: string,
    destinationAccountEmail: string,
    cause: unknown,
  ) {
    super(
      `Calendar move cleanup failed after Google created destination event "${replacementId}" in calendar "${destinationAccountEmail}". The destination may still exist; inspect or delete it before retrying.`,
    );
    this.name = "CalendarMoveRollbackError";
    this.cause = cause;
    this.replacementId = replacementId;
    this.destinationAccountEmail = destinationAccountEmail;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += GOOGLE_READ_CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + GOOGLE_READ_CONCURRENCY).map(map),
      )),
    );
  }
  return results;
}

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

function mapAttendees(event: any): CalendarEvent["attendees"] {
  return event.attendees?.map((attendee: any) => ({
    email: attendee.email,
    displayName: attendee.displayName || undefined,
    photoUrl: attendee.photoUrl || undefined,
    comment: attendee.comment || undefined,
    responseStatus: attendee.responseStatus || undefined,
    organizer: attendee.organizer || undefined,
    self: attendee.self || undefined,
    optional: attendee.optional === true ? true : undefined,
    additionalGuests:
      typeof attendee.additionalGuests === "number" &&
      attendee.additionalGuests > 0
        ? attendee.additionalGuests
        : undefined,
  }));
}

function mapOrganizer(event: any): CalendarEvent["organizer"] {
  return event.organizer
    ? {
        email: event.organizer.email,
        displayName: event.organizer.displayName || undefined,
        self: event.organizer.self || undefined,
      }
    : undefined;
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

// An offset-less edit time is wall time in the zone it names, so one supplied
// zone applies to both endpoints. The master's zones are only the fallback
// when the edit names neither, or the two endpoints would read in different
// zones and the duration would shift.
export function effectiveEditZones(
  event: { startTimeZone?: string; endTimeZone?: string },
  master: { start?: { timeZone?: string }; end?: { timeZone?: string } },
): { startTimeZone: string | undefined; endTimeZone: string | undefined } {
  return {
    startTimeZone:
      event.startTimeZone ?? event.endTimeZone ?? master.start?.timeZone,
    endTimeZone:
      event.endTimeZone ?? event.startTimeZone ?? master.end?.timeZone,
  };
}

function alignSeriesUpdateToMaster(
  event: Partial<CalendarEvent>,
  instance: any,
  master: any,
): Partial<CalendarEvent> {
  const aligned: Partial<CalendarEvent> = { ...event };
  const zones = effectiveEditZones(event, master);
  if (event.start !== undefined) {
    aligned.start = shiftSeriesDateValue(
      event.start,
      googleEventStartValue(instance),
      googleEventStartValue(master),
      master.start?.timeZone,
      zones.startTimeZone,
    );
    if (zones.startTimeZone !== undefined) {
      aligned.startTimeZone = zones.startTimeZone;
    }
  }
  if (event.end !== undefined) {
    aligned.end = shiftSeriesDateValue(
      event.end,
      googleEventEndValue(instance),
      googleEventEndValue(master),
      master.end?.timeZone,
      zones.endTimeZone,
    );
    if (zones.endTimeZone !== undefined) {
      aligned.endTimeZone = zones.endTimeZone;
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
  if (event.recurrence !== undefined) body.recurrence = event.recurrence;
  if (event.recurrence !== undefined) body.recurrence = event.recurrence;
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

async function getValidAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
  orgId?: string,
): Promise<string> {
  if (!tokens.access_token && !tokens.refresh_token) {
    // The stored record has no usable credentials at all. The most common
    // cause is a row that failed to decrypt after a SECRETS_ENCRYPTION_KEY /
    // BETTER_AUTH_SECRET rotation — core's parseStoredTokens returns `{}`
    // instead of throwing. Without this guard the expiry check below is
    // skipped (no expiry_date) and we fall through to returning
    // `tokens.access_token === undefined`, so every Google call goes out as
    // "Authorization: Bearer undefined" and 401s instead of prompting a
    // reconnect.
    //
    // Deliberately do NOT delete the row here (unlike the provider-confirmed
    // dead paths below): a failed decrypt can also mean THIS process has the
    // wrong key — e.g. a dev server pointed at a prod DB with a different
    // secret, or key material missing at boot. Deleting would irreversibly
    // destroy tokens a correctly configured deployment can still decrypt.
    // Throwing is enough: getAuthStatus excludes accounts whose token fetch
    // throws, so the UI still flips to the reconnect banner.
    throw new Error(
      `No usable OAuth tokens for ${accountId} — please reconnect.`,
    );
  }
  if (
    !tokens.access_token ||
    (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000)
  ) {
    if (!tokens.refresh_token) {
      // No refresh token means we can never recover this account; drop it
      // so the UI prompts a reconnect instead of using an expired token.
      await deleteOAuthTokens("google", accountId);
      throw new Error(
        `No refresh token available for ${accountId} — please reconnect.`,
      );
    }
    try {
      let lastRefreshError: any;
      for (const {
        clientId,
        clientSecret,
      } of await getOAuth2RefreshCredentials(owner, orgId)) {
        try {
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
          lastRefreshError = err;
          if (!isPermanentRefreshError(err?.message || "")) {
            throw err;
          }
        }
      }
      throw lastRefreshError;
    } catch (err: any) {
      if (isPermanentRefreshError(err?.message || "")) {
        await deleteOAuthTokens("google", accountId);
        throw err;
      }
      // Transient failure (network hiccup, 5xx, timeout). If the existing
      // token hasn't actually expired yet — we only entered this path
      // because we're inside the 5-minute pre-expiry buffer — fall back to
      // it so a flaky moment doesn't 502 the calendar.
      if (
        tokens.access_token &&
        tokens.expiry_date != null &&
        tokens.expiry_date > Date.now()
      ) {
        return tokens.access_token;
      }
      throw err;
    }
  }
  return tokens.access_token;
}

export async function getAuthUrl(
  origin?: string,
  redirectUri?: string,
  state?: string,
  owner?: string,
  orgId?: string,
  { selectAccount = false }: { selectAccount?: boolean } = {},
): Promise<string> {
  const { clientId, clientSecret } = await getOAuth2Credentials(owner, orgId);
  const uri =
    redirectUri ||
    (origin ? `${origin}/_agent-native/google/callback` : undefined);
  if (!uri) throw new Error("Google OAuth redirect URI is required.");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: selectAccount ? "consent select_account" : "consent",
    state,
  });
}

export async function exchangeCode(
  code: string,
  origin?: string,
  redirectUri?: string,
  owner?: string,
  orgId?: string,
): Promise<string> {
  const uri =
    redirectUri ||
    (origin ? `${origin}/_agent-native/google/callback` : undefined);
  if (!uri) throw new Error("Google OAuth redirect URI is required.");
  const { tokens, email, photoUrl } = await exchangeGoogleCode(
    code,
    uri,
    owner,
    orgId,
  );
  await saveExchangedTokens(tokens, email, photoUrl, owner);
  return email;
}

export interface GoogleSignInProfile {
  email: string;
  id?: string | undefined;
  name?: string | undefined;
  picture?: string | undefined;
  connectCalendar: () => Promise<boolean>;
}

export async function exchangeSignInCode(
  code: string,
  redirectUri: string,
  orgId?: string,
): Promise<GoogleSignInProfile> {
  const { tokens, userInfo, email, photoUrl } = await exchangeGoogleCode(
    code,
    redirectUri,
    undefined,
    orgId,
  );
  if (userInfo.verified_email !== true) {
    throw new Error(
      "Google account email is not verified. Please verify your email with Google and try again.",
    );
  }
  return {
    email,
    id: optionalString(userInfo.id),
    name: optionalString(userInfo.name),
    picture: photoUrl,
    async connectCalendar() {
      if (!grantsCalendarScope(tokens.scope)) return false;
      try {
        await saveExchangedTokens(tokens, email, photoUrl);
        return true;
      } catch (error) {
        if (
          error instanceof OAuthAccountOwnedByOtherUserError ||
          (error instanceof Error &&
            error.name === "OAuthAccountOwnedByOtherUserError")
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}

async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  owner?: string,
  orgId?: string,
) {
  const { clientId, clientSecret } = await getOAuth2Credentials(owner, orgId);
  const oauth2 = createOAuth2Client(clientId, clientSecret, redirectUri);
  const tokens = await oauth2.getToken(code);

  const userInfo = await oauth2GetUserInfo(tokens.access_token);
  const email = userInfo.email;
  if (!email) throw new Error("Google returned no email address");
  return {
    tokens,
    userInfo,
    email: email as string,
    photoUrl: optionalString(userInfo.picture),
  };
}

async function saveExchangedTokens(
  tokens: object,
  email: string,
  photoUrl: string | undefined,
  owner?: string,
): Promise<void> {
  await saveOAuthTokens(
    "google",
    email,
    { ...tokens, ...(photoUrl ? { photoUrl } : {}) } as Record<string, unknown>,
    owner ?? email,
  );
  invalidateAccountTimezoneCache(email);
  if (owner) invalidateAccountTimezoneCache(owner);
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

async function getBetterAuthUserImage(
  email: string | undefined,
): Promise<string | undefined> {
  if (!email) return undefined;
  try {
    const { rows } = await getDbExec().execute({
      sql: 'SELECT image FROM "user" WHERE email = $1 LIMIT 1',
      args: [email],
    });
    return optionalString(rows[0]?.image);
  } catch {
    return undefined;
  }
}

export async function getClient(
  email: string | undefined,
): Promise<{ accessToken: string } | null> {
  if (!email) return null;
  const accounts = (await listOAuthAccountsByOwner("google", email)).filter(
    (account) => hasCalendarScope(account.tokens),
  );
  if (accounts.length === 0) return resolveManagedCalendarClient();

  const account = accounts.find((a) => a.accountId === email) ?? accounts[0];

  const tokens = account.tokens as unknown as GoogleTokens;
  const accessToken = await getValidAccessToken(
    account.accountId,
    tokens,
    email,
  );
  return { accessToken };
}

const accountTimezoneCache = new Map<
  string,
  { value: string | null; expiresAt: number }
>();
const ACCOUNT_TIMEZONE_CACHE_TTL_MS = 60 * 60 * 1000;
const ACCOUNT_TIMEZONE_CACHE_MAX_ENTRIES = 500;

// Only cache confirmed outcomes (has/doesn't have a resolvable time zone).
// A thrown error (token refresh, network, provider failure) is never cached
// — it's indistinguishable from a real "no time zone" answer, and caching it
// would silently disable a peer's working-hours filter for the TTL even
// right after they reconnect.
function cacheAccountTimezone(key: string, value: string | null): void {
  if (
    !accountTimezoneCache.has(key) &&
    accountTimezoneCache.size >= ACCOUNT_TIMEZONE_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = accountTimezoneCache.keys().next().value;
    if (oldestKey !== undefined) accountTimezoneCache.delete(oldestKey);
  }
  accountTimezoneCache.set(key, {
    value,
    expiresAt: Date.now() + ACCOUNT_TIMEZONE_CACHE_TTL_MS,
  });
}

const accountTimezoneEpoch = new Map<string, number>();

export function invalidateAccountTimezoneCache(email: string): void {
  const key = email.trim().toLowerCase();
  accountTimezoneCache.delete(key);
  accountTimezoneEpoch.set(key, (accountTimezoneEpoch.get(key) ?? 0) + 1);
}

const accountTimezoneInFlight = new Map<string, Promise<string | null>>();

export async function getGoogleAccountTimezone(
  email: string | undefined,
): Promise<string | null> {
  if (!email) return null;
  const key = email.trim().toLowerCase();
  const cached = accountTimezoneCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value;
    accountTimezoneCache.delete(key);
  }

  const inFlight = accountTimezoneInFlight.get(key);
  if (inFlight) return inFlight;

  const epoch = accountTimezoneEpoch.get(key) ?? 0;
  const lookup = resolveGoogleAccountTimezone(key, email, epoch).finally(() => {
    accountTimezoneInFlight.delete(key);
  });
  accountTimezoneInFlight.set(key, lookup);
  return lookup;
}

async function resolveGoogleAccountTimezone(
  key: string,
  email: string,
  epoch: number,
): Promise<string | null> {
  let accounts: Awaited<ReturnType<typeof listOAuthAccountsByOwner>>;
  try {
    accounts = (await listOAuthAccountsByOwner("google", email)).filter(
      (account) => hasCalendarScope(account.tokens),
    );
  } catch {
    // coercion-ok: deliberately not the same as "confirmed no account" —
    // this is never cached (see cacheAccountTimezone), so the caller
    // (getEligibleHostAvailability) re-checks on the next request instead
    // of a lookup failure being treated as a stable negative result.
    return null;
  }

  if (accounts.length === 0) {
    if ((accountTimezoneEpoch.get(key) ?? 0) === epoch) {
      cacheAccountTimezone(key, null);
    }
    return null;
  }

  const account =
    accounts.find((a) => a.accountId.trim().toLowerCase() === key) ??
    accounts[0];

  let accessToken: string;
  try {
    const tokens = account.tokens as unknown as GoogleTokens;
    accessToken = await getValidAccessToken(account.accountId, tokens, email);
  } catch {
    // coercion-ok: same reasoning as the lookup catch above.
    return null;
  }

  let timezone: string | null = null;
  let resolved = false;
  for (let attempt = 0; attempt < 2 && !resolved; attempt++) {
    try {
      const calendar = await calendarGetCalendar(accessToken, "primary");
      timezone = isCalendarTimezone(calendar?.timeZone)
        ? calendar.timeZone
        : null;
      resolved = true;
    } catch {
      // coercion-ok: retried once above; the final failure after both
      // attempts is handled distinctly (never cached) by the
      // `if (!resolved)` branch right after this loop.
    }
  }
  if (!resolved) {
    // coercion-ok: deliberately not the same as "confirmed no timezone" —
    // this is never cached (see cacheAccountTimezone), so the caller
    // (getEligibleHostAvailability) re-checks on the next request instead
    // of a lookup failure being treated as a stable negative result.
    return null;
  }

  if ((accountTimezoneEpoch.get(key) ?? 0) === epoch) {
    cacheAccountTimezone(key, timezone);
  }
  return timezone;
}

export interface GoogleAccountSelection {
  ownerEmail: string;
  accountEmail: string;
}

export async function getDefaultAccountSelection(
  ownerEmail: string,
): Promise<GoogleAccountSelection> {
  const accounts = (
    await listOAuthAccountsByOwner("google", ownerEmail)
  ).filter((account) => hasCalendarScope(account.tokens));
  const account =
    accounts.find(
      (candidate) =>
        candidate.accountId.trim().toLowerCase() ===
        ownerEmail.trim().toLowerCase(),
    ) ?? accounts[0];
  if (!account) {
    const managed = await resolveManagedCalendarClient();
    if (managed) {
      return { ownerEmail, accountEmail: managed.email };
    }
    throw new Error(
      "Google Calendar not connected. Connect via Settings first.",
    );
  }
  return { ownerEmail, accountEmail: account.accountId };
}

export async function getClientForAccount({
  ownerEmail,
  accountEmail,
}: GoogleAccountSelection): Promise<{ accessToken: string }> {
  const normalizedAccountEmail = accountEmail.trim().toLowerCase();
  const accounts = (
    await listOAuthAccountsByOwner("google", ownerEmail)
  ).filter((account) => hasCalendarScope(account.tokens));
  const account = accounts.find(
    (candidate) =>
      candidate.accountId.trim().toLowerCase() === normalizedAccountEmail,
  );
  if (!account) {
    const managed = await resolveManagedCalendarClient();
    if (
      managed &&
      managed.email.trim().toLowerCase() === normalizedAccountEmail
    ) {
      return { accessToken: managed.accessToken };
    }
    throw new Error(
      `Google Calendar account not connected for this user: ${accountEmail}`,
    );
  }

  const accessToken = await getValidAccessToken(
    account.accountId,
    account.tokens as unknown as GoogleTokens,
    ownerEmail,
  );
  return { accessToken };
}

export async function getClients(
  forEmail?: string,
): Promise<Array<{ email: string; accessToken: string }>> {
  const { clients } = await getClientsWithErrors(forEmail);
  return clients;
}

export async function getClientsWithErrors(forEmail?: string): Promise<{
  clients: Array<{ email: string; accessToken: string }>;
  errors: Array<{ email: string; error: string }>;
}> {
  if (!forEmail) return { clients: [], errors: [] };
  const accounts = (await listOAuthAccountsByOwner("google", forEmail)).filter(
    (account) => hasCalendarScope(account.tokens),
  );

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

  if (clients.length === 0) {
    try {
      const managed = await resolveManagedCalendarClient();
      if (managed) clients.push(managed);
    } catch (err: any) {
      errors.push({
        email: "workspace",
        error: err?.message || "Workspace Google Calendar connection failed",
      });
    }
  }

  return { clients, errors };
}

export async function getOwnedAccountEmails(
  forEmail?: string,
): Promise<string[]> {
  if (!forEmail) return [];
  const accounts = (await listOAuthAccountsByOwner("google", forEmail)).filter(
    (account) => hasCalendarScope(account.tokens),
  );
  return accounts.map((account) => account.accountId);
}

export async function getClientsForAccountsWithErrors(
  forEmail: string | undefined,
  accountEmails?: string[],
): Promise<{
  clients: Array<{ email: string; accessToken: string }>;
  errors: Array<{ email: string; error: string; code?: string }>;
  requestedAccounts: string[];
  resolvedAccounts: string[];
}> {
  if (!forEmail) {
    return {
      clients: [],
      errors: [],
      requestedAccounts: [],
      resolvedAccounts: [],
    };
  }
  const accounts = (await listOAuthAccountsByOwner("google", forEmail)).filter(
    (account) => hasCalendarScope(account.tokens),
  );
  if (accounts.length === 0) {
    let managed: ManagedCalendarClient | null = null;
    let managedError: { error: string; code?: string } | undefined;
    try {
      managed = await resolveManagedCalendarClient();
    } catch (err: any) {
      const code = googleReadErrorCode(err);
      managedError = {
        error: err?.message || "Workspace Google Calendar connection failed",
        ...(code ? { code } : {}),
      };
    }
    if (!managed) {
      if (accountEmails?.length && !managedError) {
        throw new Error(
          `Google Calendar account not connected for this user: ${accountEmails.join(", ")}`,
        );
      }
      return {
        clients: [],
        errors: managedError ? [{ email: "workspace", ...managedError }] : [],
        requestedAccounts: [],
        resolvedAccounts: [],
      };
    }
    const requestedAccounts = Array.from(
      new Set(
        (accountEmails ?? [managed.email])
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    if (
      requestedAccounts.some(
        (email) => email !== managed.email.trim().toLowerCase(),
      )
    ) {
      throw new Error(
        `Google Calendar account not connected for this user: ${requestedAccounts.join(", ")}`,
      );
    }
    return {
      clients: [managed],
      errors: [],
      requestedAccounts,
      resolvedAccounts: [managed.email],
    };
  }
  const byNormalized = new Map(
    accounts.map((account) => [
      account.accountId.trim().toLowerCase(),
      account,
    ]),
  );
  const requestedAccounts = Array.from(
    new Set(
      (accountEmails ?? accounts.map((account) => account.accountId))
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const unowned = requestedAccounts.filter((email) => !byNormalized.has(email));
  if (unowned.length > 0) {
    throw new Error(
      `Google Calendar account not connected for this user: ${unowned.join(", ")}`,
    );
  }
  const selected = requestedAccounts.map((email) => byNormalized.get(email)!);
  const clients: Array<{ email: string; accessToken: string }> = [];
  const errors: Array<{ email: string; error: string; code?: string }> = [];
  await mapWithConcurrency(selected, async (account) => {
    try {
      const accessToken = await getValidAccessToken(
        account.accountId,
        account.tokens as unknown as GoogleTokens,
        forEmail,
      );
      clients.push({ email: account.accountId, accessToken });
    } catch (err: any) {
      const code = googleReadErrorCode(err);
      errors.push({
        email: account.accountId,
        error: err?.message || "Unknown refresh error",
        ...(code ? { code } : {}),
      });
    }
  });
  clients.sort((a, b) => a.email.localeCompare(b.email));
  errors.sort((a, b) => a.email.localeCompare(b.email));
  return {
    clients,
    errors,
    requestedAccounts,
    resolvedAccounts: selected.map((account) => account.accountId),
  };
}

function asCalendarAccessRole(
  value: unknown,
): GoogleCalendarSource["accessRole"] | null {
  return value === "freeBusyReader" ||
    value === "reader" ||
    value === "writer" ||
    value === "owner"
    ? value
    : null;
}

const CALENDAR_ACCESS_RANK = {
  freeBusyReader: 0,
  reader: 1,
  writer: 2,
  owner: 3,
} as const;

function compareCalendarSourcePaths(
  a: GoogleCalendarSource,
  b: GoogleCalendarSource,
): number {
  const role =
    CALENDAR_ACCESS_RANK[b.accessRole] - CALENDAR_ACCESS_RANK[a.accessRole];
  if (role !== 0) return role;
  if (a.primary !== b.primary) return a.primary ? -1 : 1;
  return a.accountEmail.localeCompare(b.accountEmail);
}

function compareCalendarEventSources(
  a: CalendarEvent,
  b: CalendarEvent,
): number {
  const writable =
    Number(b.calendarReadOnly === false) - Number(a.calendarReadOnly === false);
  if (writable !== 0) return writable;

  const primary =
    Number(b.calendarPrimary === true) - Number(a.calendarPrimary === true);
  if (primary !== 0) return primary;

  const access =
    (CALENDAR_ACCESS_RANK[b.calendarAccessRole ?? "freeBusyReader"] ?? -1) -
    (CALENDAR_ACCESS_RANK[a.calendarAccessRole ?? "freeBusyReader"] ?? -1);
  if (access !== 0) return access;

  return (a.accountEmail ?? "").localeCompare(b.accountEmail ?? "");
}

export async function resolveGoogleCalendarSource(
  ownerEmail: string,
  sourceKey: string,
): Promise<GoogleCalendarSource> {
  const discovered = await listGoogleCalendars(ownerEmail);
  const source = discovered.calendars
    .flatMap((candidate) =>
      (candidate.sourcePaths ?? [candidate]).map((path) => ({
        ...candidate,
        ...path,
        readOnly:
          path.primary !== true ||
          (path.accessRole !== "owner" && path.accessRole !== "writer"),
      })),
    )
    .find((candidate) => candidate.sourceKey === sourceKey);
  if (!source) {
    throw new Error(
      "Google Calendar source is not connected or no longer available",
    );
  }
  return source;
}

function googleReadErrorCode(error: unknown): string | undefined {
  if (!(error instanceof GoogleApiError)) return undefined;
  if (
    error.status === 429 ||
    (error.status === 403 &&
      [
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "quotaExceeded",
        "dailyLimitExceeded",
        "rate_limit_exceeded",
      ].includes(error.reason ?? ""))
  )
    return "RATE_LIMITED";
  return error.status === 401 ? "AUTH_REQUIRED" : undefined;
}

export async function listGoogleCalendars(forEmail?: string): Promise<{
  calendars: GoogleCalendarSource[];
  errors: Array<{ email: string; error: string; code?: string }>;
}> {
  const { clients, errors: refreshErrors } =
    await getClientsForAccountsWithErrors(forEmail);
  const errors: Array<{ email: string; error: string; code?: string }> = [
    ...refreshErrors,
  ];
  const results = await mapWithConcurrency(clients, async (client) => {
    try {
      const items: any[] = [];
      let pageToken: string | undefined;
      do {
        const response = await calendarListCalendars(client.accessToken, {
          maxResults: 250,
          pageToken,
        });
        items.push(...(response.items ?? []));
        pageToken =
          typeof response.nextPageToken === "string"
            ? response.nextPageToken
            : undefined;
      } while (pageToken);
      return items
        .filter((item) => typeof item.id === "string" && item.id.length > 0)
        .flatMap((item): GoogleCalendarSource[] => {
          const accessRole = asCalendarAccessRole(item.accessRole);
          if (!accessRole) return [];
          return [
            {
              sourceKey: createGoogleCalendarSourceKey({
                accountEmail: client.email,
                calendarId: item.id,
              }),
              canonicalKey: createGoogleCalendarCanonicalKey(item.id),
              accountEmail: client.email,
              calendarId: item.id,
              name: item.summaryOverride || item.summary || item.id,
              color: item.backgroundColor || undefined,
              selected: item.selected === true,
              primary: item.primary === true,
              accessRole,
              readOnly:
                item.primary !== true ||
                (accessRole !== "owner" && accessRole !== "writer"),
            },
          ];
        });
    } catch (error: any) {
      const code = googleReadErrorCode(error);
      errors.push({
        email: client.email,
        ...(code ? { code } : {}),
        error: error?.message || "Unable to list Google calendars",
      });
      return [];
    }
  });
  return {
    calendars: Array.from(
      results.flat().reduce((byCalendar, source) => {
        const paths = byCalendar.get(source.calendarId) ?? [];
        paths.push(source);
        byCalendar.set(source.calendarId, paths);
        return byCalendar;
      }, new Map<string, GoogleCalendarSource[]>()),
    )
      .map(([, paths]) => {
        const sortedPaths = [...paths].sort(compareCalendarSourcePaths);
        const selected = sortedPaths[0]!;
        return {
          ...selected,
          primary: sortedPaths.some((path) => path.primary),
          sourcePaths: sortedPaths.map((path) => ({
            sourceKey: path.sourceKey,
            accountEmail: path.accountEmail,
            accessRole: path.accessRole,
            primary: path.primary,
          })),
        };
      })
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
    errors: errors.sort((a, b) => a.email.localeCompare(b.email)),
  };
}

export async function isConnected(forEmail?: string): Promise<boolean> {
  if (!forEmail) return false;
  const accounts = await listOAuthAccountsByOwner("google", forEmail);
  if (accounts.some((account) => hasCalendarScope(account.tokens))) return true;
  return hasManagedCalendarConnection();
}

export async function getConnectedAccounts(
  forEmail?: string,
): Promise<string[]> {
  if (!forEmail) return [];
  const accounts = (await listOAuthAccountsByOwner("google", forEmail)).filter(
    (account) => hasCalendarScope(account.tokens),
  );
  if (accounts.length > 0) return accounts.map((a) => a.accountId);
  const managed = await resolveManagedCalendarClient();
  return managed ? [managed.email] : [];
}

export async function getPrimaryAccountPhotoUrl(
  forEmail?: string,
): Promise<string | undefined> {
  if (!forEmail) return undefined;
  const fallbackUserImage = await getBetterAuthUserImage(forEmail);
  const accounts = (await listOAuthAccountsByOwner("google", forEmail)).filter(
    (account) => hasCalendarScope(account.tokens),
  );
  const account = accounts.find((a) => a.accountId === forEmail) ?? accounts[0];
  if (!account) return fallbackUserImage;

  const tokens = account.tokens as unknown as GoogleTokens;
  const cachedPhotoUrl = optionalString(tokens.photoUrl);
  if (cachedPhotoUrl) return cachedPhotoUrl;

  try {
    const accessToken = await getValidAccessToken(
      account.accountId,
      tokens,
      forEmail,
    );
    return (await resolveAccountPhotoUrl(accessToken)) ?? fallbackUserImage;
  } catch {
    return fallbackUserImage;
  }
}

export async function getAuthStatus(
  forEmail?: string,
  orgId?: string,
): Promise<GoogleAuthStatus> {
  const oauthAccounts = (await getOAuthAccounts("google", forEmail)).filter(
    (account) => hasCalendarScope(account.tokens),
  );

  if (oauthAccounts.length === 0) {
    const managed = await resolveManagedCalendarClient();
    return managed
      ? { connected: true, accounts: [{ email: managed.email, shared: true }] }
      : { connected: false, accounts: [] };
  }

  const result: Array<{
    email: string;
    expiresAt?: string;
    photoUrl?: string;
    shared?: boolean;
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
        orgId,
      );
      tokenValid = true;
      photoUrl = await resolveAccountPhotoUrl(accessToken, photoUrl);
    } catch (err: unknown) {
      // A permanently revoked or unusable token must drop out so `connected`
      // flips to false. A transient refresh failure (network, 5xx, missing
      // client credentials) leaves the account connected; excluding it would
      // show "Connect Google" for a healthy account.
      const message =
        err !== null &&
        (typeof err === "object" || typeof err === "function") &&
        "message" in err
          ? String(err.message ?? "")
          : "";
      tokenValid =
        !isPermanentRefreshError(message) && !/please reconnect/i.test(message);
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
  let owner: string | null = null;
  if (email) {
    const accounts = await listOAuthAccounts("google");
    owner = accounts.find((a) => a.accountId === email)?.owner ?? null;
  }

  await deleteOAuthTokens("google", email);
  if (email) invalidateAccountTimezoneCache(email);
  if (owner) invalidateAccountTimezoneCache(owner);
}

export async function listEvents(
  timeMin: string,
  timeMax: string,
  forEmail?: string,
  options: {
    accountEmails?: string[];
    calendarSourceKeys?: string[];
    maxResults?: number;
    incremental?: boolean;
  } = {},
): Promise<{
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string; code?: string }>;
}> {
  const { clients, errors: refreshErrors } =
    await getClientsForAccountsWithErrors(forEmail, options.accountEmails);
  const errors: Array<{ email: string; error: string; code?: string }> = [
    ...refreshErrors,
  ];
  if (clients.length === 0) return { events: [], errors };
  const hasMultipleOwnedAccounts =
    clients.length > 1 || (await getOwnedAccountEmails(forEmail)).length > 1;

  const requestedSourceKeys = Array.from(
    new Set((options.calendarSourceKeys ?? []).filter(Boolean)),
  );
  let selectedSourcesByAccount = new Map<string, GoogleCalendarSource[]>();
  if (requestedSourceKeys.length > 0) {
    const discovered = await listGoogleCalendars(forEmail);
    errors.push(...discovered.errors);
    const discoveredByKey = new Map<
      string,
      {
        source: GoogleCalendarSource;
        paths: Array<
          Pick<
            GoogleCalendarSource,
            "sourceKey" | "accountEmail" | "accessRole" | "primary"
          >
        >;
      }
    >();
    for (const source of discovered.calendars) {
      const paths = source.sourcePaths ?? [source];
      discoveredByKey.set(source.sourceKey, { source, paths });
      for (const path of paths) {
        if (path.sourceKey !== source.sourceKey) {
          discoveredByKey.set(path.sourceKey, { source, paths: [path] });
        }
      }
    }
    const invalid = requestedSourceKeys.filter(
      (sourceKey) => !discoveredByKey.has(sourceKey),
    );
    if (invalid.length > 0 && discovered.errors.length === 0) {
      throw new Error(
        `Google Calendar source is not connected or no longer available: ${invalid.join(", ")}`,
      );
    }
    for (const sourceKey of requestedSourceKeys) {
      const discoveredSource = discoveredByKey.get(sourceKey);
      if (!discoveredSource) continue;
      const { source, paths } = discoveredSource;
      for (const path of paths) {
        const accountKey = path.accountEmail.trim().toLowerCase();
        selectedSourcesByAccount.set(accountKey, [
          ...(selectedSourcesByAccount.get(accountKey) ?? []),
          {
            ...source,
            sourceKey: path.sourceKey,
            accountEmail: path.accountEmail,
            accessRole: path.accessRole,
            primary: path.primary,
            readOnly:
              path.primary !== true ||
              (path.accessRole !== "owner" && path.accessRole !== "writer"),
          },
        ]);
      }
    }
    const availableAccounts = new Set(
      clients.map((client) => client.email.trim().toLowerCase()),
    );
    const excluded = Array.from(selectedSourcesByAccount.keys()).filter(
      (accountEmail) => !availableAccounts.has(accountEmail),
    );
    if (excluded.length > 0) {
      throw new Error(
        `Google Calendar source account was not selected: ${excluded.join(", ")}`,
      );
    }
  }

  const allResults = await mapWithConcurrency(
    clients,
    async ({ email, accessToken }) => {
      try {
        const sources =
          requestedSourceKeys.length > 0
            ? (selectedSourcesByAccount.get(email.trim().toLowerCase()) ?? [])
            : [undefined];
        const preloaded =
          options.incremental && forEmail
            ? await Promise.allSettled(
                sources.map((source) =>
                  source?.accessRole === "freeBusyReader"
                    ? Promise.resolve([])
                    : listSyncedGoogleEvents({
                        owner: forEmail,
                        orgId: getRequestOrgId() ?? undefined,
                        account: email,
                        accessToken,
                        calendarId: source?.calendarId ?? "primary",
                        timeMin,
                        timeMax,
                        eventTypes: LIST_EVENT_TYPES,
                        maxResults: options.maxResults ?? 2500,
                      }),
                ),
              )
            : null;
        const events: any[] = [];
        for (const [index, source] of sources.entries()) {
          if (source?.accessRole === "freeBusyReader") {
            errors.push({
              email,
              error: `Google Calendar source ${source.name} (${source.calendarId}) only grants free/busy access; detailed events were not read`,
            });
            continue;
          }
          try {
            if (preloaded) {
              const result = preloaded.find(
                (_, position) => position === index,
              );
              if (!result)
                throw new Error("Google Calendar batch response is incomplete");
              if (result.status === "rejected") throw result.reason;
              events.push(
                ...result.value.map((event) => ({
                  ...event,
                  __calendarSource: source,
                })),
              );
              continue;
            }
            let pageToken: string | undefined;
            do {
              const response = await calendarListEvents(
                accessToken,
                source?.calendarId ?? "primary",
                {
                  timeMin,
                  timeMax,
                  singleEvents: true,
                  orderBy: "startTime",
                  maxResults: options.maxResults ?? 2500,
                  pageToken,
                  eventTypes: LIST_EVENT_TYPES,
                },
              );
              events.push(
                ...(response.items || []).map((event: any) => ({
                  ...event,
                  __calendarSource: source,
                })),
              );
              pageToken =
                typeof response.nextPageToken === "string"
                  ? response.nextPageToken
                  : undefined;
            } while (pageToken);
          } catch (error: any) {
            const code = googleReadErrorCode(error);
            errors.push({
              email,
              ...(code ? { code } : {}),
              error: source
                ? `Unable to read Google Calendar source ${source.name} (${source.calendarId}): ${error?.message || "Unknown provider error"}`
                : error?.message || "Unable to load Google Calendar events",
            });
          }
        }

        return events.map((event: any) => {
          const calendarSource = event.__calendarSource as
            | GoogleCalendarSource
            | undefined;
          const selfAttendee = event.attendees?.find(
            (a: any) => a.self === true,
          );
          return {
            id:
              calendarSource && !calendarSource.primary
                ? `google-${calendarSource.sourceKey}-${event.id}`
                : hasMultipleOwnedAccounts
                  ? createGoogleAccountEventId({
                      accountEmail: email,
                      googleEventId: event.id,
                    })
                  : `google-${event.id}`,
            title: event.summary || "Untitled",
            titleIsGenerated: !event.summary,
            description: event.description || "",
            start: event.start?.dateTime || event.start?.date || "",
            end: event.end?.dateTime || event.end?.date || "",
            startTimeZone: event.start?.timeZone || undefined,
            endTimeZone: event.end?.timeZone || undefined,
            location: event.location || "",
            allDay: !event.start?.dateTime,
            source: "google" as const,
            googleEventId: event.id || undefined,
            revision: event.etag || undefined,
            htmlLink: event.htmlLink || undefined,
            accountEmail: email,
            calendarSourceKey: calendarSource?.sourceKey,
            canonicalKey: calendarSource?.canonicalKey,
            calendarId: calendarSource?.calendarId,
            calendarName: calendarSource?.name,
            calendarColor: calendarSource?.color,
            calendarAccessRole: calendarSource?.accessRole,
            calendarPrimary: calendarSource?.primary,
            calendarReadOnly: calendarSource?.readOnly,
            responseStatus: selfAttendee?.responseStatus,
            transparency: event.transparency || undefined,
            ...mapColor(event),
            eventType: event.eventType || "default",
            attendees: mapAttendees(event),
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
            organizer: mapOrganizer(event),
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
    },
  );

  const events = allResults.flat();
  const dedupedEvents = new Map<string, CalendarEvent>();
  for (const event of events) {
    const key =
      event.canonicalKey && event.googleEventId
        ? `${event.canonicalKey}:${event.googleEventId}`
        : event.googleEventId && event.accountEmail
          ? `google-account:${event.accountEmail.toLowerCase()}:${event.googleEventId}`
          : event.id;
    const existing = dedupedEvents.get(key);
    if (!existing || compareCalendarEventSources(event, existing) < 0) {
      dedupedEvents.set(key, event);
    }
  }
  return { events: Array.from(dedupedEvents.values()), errors };
}

export async function getFreeBusy(
  timeMin: string,
  timeMax: string,
  calendarIds: string[],
  forEmail?: string,
  timeZone?: string,
  accountEmail?: string,
): Promise<{
  calendars: Record<
    string,
    {
      busy: Array<{ start: string; end: string }>;
      errors?: Array<{ domain?: string; reason?: string }>;
    }
  >;
  errors: Array<{ email: string; error: string }>;
}> {
  const ids = Array.from(
    new Set(
      calendarIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
        .map((id) => id.toLowerCase()),
    ),
  );
  if (ids.length === 0) return { calendars: {}, errors: [] };

  const { clients, errors } = await getClientsWithErrors(forEmail);
  if (clients.length === 0) return { calendars: {}, errors };
  const selectedAccount = accountEmail?.trim().toLowerCase();
  const client = selectedAccount
    ? clients.find((entry) => entry.email.toLowerCase() === selectedAccount)
    : clients[0];
  if (!client) {
    return {
      calendars: {},
      errors: [
        ...errors,
        {
          email: accountEmail ?? "google",
          error: "Selected Google account is not connected.",
        },
      ],
    };
  }

  try {
    const response = await calendarFreeBusy(client.accessToken, {
      timeMin,
      timeMax,
      timeZone,
      items: ids.map((id) => ({ id })),
    });
    const calendars = (response.calendars ?? {}) as Record<
      string,
      {
        busy?: Array<{ start: string; end: string }>;
        errors?: Array<{ domain?: string; reason?: string }>;
      }
    >;
    const normalized: Record<
      string,
      {
        busy: Array<{ start: string; end: string }>;
        errors?: Array<{ domain?: string; reason?: string }>;
      }
    > = {};
    const calendarErrors: Array<{ email: string; error: string }> = [];

    for (const id of ids) {
      const calendar = calendars[id] ?? calendars[id.toLowerCase()];
      const calendarError = calendar?.errors
        ?.map((error) => error.reason || error.domain)
        .filter(Boolean)
        .join(", ");
      const missingCalendarError = calendar
        ? undefined
        : "Calendar was omitted from the Google free/busy response";
      const error = calendarError || missingCalendarError;
      normalized[id] = {
        busy: calendar?.busy ?? [],
        errors:
          calendar?.errors ||
          (missingCalendarError
            ? [{ reason: missingCalendarError }]
            : undefined),
      };
      if (error) {
        calendarErrors.push({ email: id, error });
      }
    }

    return { calendars: normalized, errors: [...errors, ...calendarErrors] };
  } catch (error: any) {
    return {
      calendars: {},
      errors: [
        ...errors,
        {
          email: accountEmail ?? forEmail ?? "google",
          error: error?.message || "Unable to load Google free/busy data",
        },
      ],
    };
  }
}

export async function listOverlayEvents(
  timeMin: string,
  timeMax: string,
  overlayEmails: string[],
  forEmail?: string,
  options: { accountEmails?: string[]; incremental?: boolean } = {},
): Promise<{
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string; code?: string }>;
  accountErrors: Array<{ email: string; error: string; code?: string }>;
}> {
  let clients: Array<{ email: string; accessToken: string }>;
  let refreshErrors: Array<{ email: string; error: string; code?: string }>;
  try {
    const resolved = await getClientsForAccountsWithErrors(
      forEmail,
      options.accountEmails,
    );
    clients = resolved.clients;
    refreshErrors = resolved.errors;
  } catch (error: any) {
    const message = error?.message || "Unable to load overlay calendars";
    return {
      events: [],
      errors: overlayEmails.map((email) => ({ email, error: message })),
      accountErrors: [{ email: forEmail ?? "google", error: message }],
    };
  }
  const errors: Array<{ email: string; error: string; code?: string }> = [];
  if (clients.length === 0) {
    const message =
      refreshErrors[0]?.error ?? "Google Calendar is not connected";
    return {
      events: [],
      errors: overlayEmails.map((email) => ({
        email,
        error: message,
        ...(refreshErrors[0]?.code ? { code: refreshErrors[0].code } : {}),
      })),
      accountErrors: refreshErrors,
    };
  }

  const allResults = await Promise.all(
    overlayEmails.map(async (overlayEmail) => {
      const accessErrors: string[] = [];
      const failureCodes: string[] = [];
      for (const client of clients) {
        try {
          const events: any[] = [];
          if (options.incremental && forEmail) {
            events.push(
              ...(await listSyncedGoogleEvents({
                owner: forEmail,
                orgId: getRequestOrgId() ?? undefined,
                account: client.email,
                accessToken: client.accessToken,
                calendarId: overlayEmail,
                timeMin,
                timeMax,
                eventTypes: LIST_EVENT_TYPES,
                maxResults: 2500,
              })),
            );
          } else {
            let pageToken: string | undefined;
            do {
              const response = await calendarListEvents(
                client.accessToken,
                overlayEmail,
                {
                  timeMin,
                  timeMax,
                  singleEvents: true,
                  orderBy: "startTime",
                  eventTypes: LIST_EVENT_TYPES,
                  pageToken,
                },
              );
              events.push(...(response.items || []));
              pageToken = response.nextPageToken;
            } while (pageToken);
          }
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
            accountEmail: client.email,
            overlayEmail,
            calendarPrimary: false,
            calendarReadOnly: true,
            ...mapColor(event),
            attendees: mapAttendees(event),
            organizer: mapOrganizer(event),
            createdAt: event.created || new Date().toISOString(),
            updatedAt: event.updated || new Date().toISOString(),
          }));
        } catch (error: any) {
          const code = googleReadErrorCode(error);
          if (code) failureCodes.push(code);
          const message = error?.message || "Unable to read overlay calendar";
          console.error(
            `[listOverlayEvents] Error fetching ${overlayEmail} via ${client.email}:`,
            message,
          );
          accessErrors.push(`${client.email}: ${message}`);
        }
      }

      errors.push({
        email: overlayEmail,
        error: `No selected Google account could read this overlay (${accessErrors.join("; ")})`,
        ...(failureCodes.includes("RATE_LIMITED")
          ? { code: "RATE_LIMITED" }
          : failureCodes.includes("AUTH_REQUIRED")
            ? { code: "AUTH_REQUIRED" }
            : {}),
      });
      return [];
    }),
  );

  return { events: allResults.flat(), errors, accountErrors: refreshErrors };
}

export async function getEvent(
  googleEventId: string,
  account: GoogleAccountSelection,
  options: { calendarSourceKey?: string; signal?: AbortSignal } = {},
): Promise<CalendarEvent> {
  let calendarSource: GoogleCalendarSource | undefined;
  if (options.calendarSourceKey) {
    calendarSource = await resolveGoogleCalendarSource(
      account.ownerEmail,
      options.calendarSourceKey,
    );
    if (
      !calendarSource ||
      calendarSource.accountEmail.trim().toLowerCase() !==
        account.accountEmail.trim().toLowerCase()
    ) {
      throw new Error(
        "Google Calendar source is not connected or no longer available",
      );
    }
    if (calendarSource.accessRole === "freeBusyReader") {
      throw new Error("Google Calendar source only grants free/busy access");
    }
  }
  const client = await getClientForAccount(account);
  options.signal?.throwIfAborted();

  const event = await calendarGetEvent(
    client.accessToken,
    calendarSource?.calendarId ?? "primary",
    googleEventId,
    options.signal,
  );
  const selfAttendee = event.attendees?.find((a: any) => a.self === true);

  return {
    id: calendarSource
      ? `google-${calendarSource.sourceKey}-${event.id}`
      : `google-${event.id}`,
    title: event.summary || "Untitled",
    titleIsGenerated: !event.summary,
    description: event.description || "",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    startTimeZone: event.start?.timeZone || undefined,
    endTimeZone: event.end?.timeZone || undefined,
    location: event.location || "",
    allDay: !event.start?.dateTime,
    source: "google",
    googleEventId: event.id || undefined,
    revision: event.etag || undefined,
    htmlLink: event.htmlLink || undefined,
    accountEmail: account.accountEmail,
    calendarSourceKey: calendarSource?.sourceKey,
    canonicalKey: calendarSource?.canonicalKey,
    calendarId: calendarSource?.calendarId,
    calendarName: calendarSource?.name,
    calendarColor: calendarSource?.color,
    calendarAccessRole: calendarSource?.accessRole,
    calendarPrimary: calendarSource?.primary,
    calendarReadOnly: calendarSource?.readOnly,
    responseStatus: selfAttendee?.responseStatus || undefined,
    transparency: event.transparency || undefined,
    ...mapColor(event),
    eventType: event.eventType || "default",
    attendees: mapAttendees(event),
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
    organizer: mapOrganizer(event),
    createdAt: event.created || new Date().toISOString(),
    updatedAt: event.updated || new Date().toISOString(),
  };
}

function timedWorkingLocationSummary(event: CalendarEvent): string | undefined {
  if (event.eventType !== "workingLocation" || event.allDay) return undefined;
  const properties = event.workingLocationProperties;
  if (properties?.type === "officeLocation") {
    return properties.officeLocation?.label || "Office";
  }
  if (properties?.type === "customLocation") {
    return properties.customLocation?.label || "Working location";
  }
  if (properties?.type === "homeOffice") return "Home";
  const trimmed = event.title?.trim();
  if (trimmed && !event.titleIsGenerated) return trimmed;
  return "Home";
}

export async function createEvent(
  event: CalendarEvent,
  opts: {
    account: GoogleAccountSelection;
    addGoogleMeet?: boolean;
    sendUpdates?: "all" | "externalOnly" | "none";
  },
): Promise<{
  id?: string;
  htmlLink?: string;
  meetLink?: string;
  conferenceData?: CalendarEvent["conferenceData"];
}> {
  const client = await getClientForAccount(opts.account);
  if (
    (event.eventType === "outOfOffice" || event.eventType === "focusTime") &&
    event.allDay
  ) {
    throw new Error("Out of office and focus time events must be timed.");
  }

  const workingLocationSummary = timedWorkingLocationSummary(event);
  const body: any =
    event.eventType === "workingLocation"
      ? {
          ...buildDateRange(event),
          ...(workingLocationSummary
            ? { summary: workingLocationSummary }
            : {}),
        }
      : {
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
      ...(a.comment ? { comment: a.comment } : {}),
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
      ...(a.optional === true ? { optional: true } : {}),
      ...(a.additionalGuests !== undefined
        ? { additionalGuests: a.additionalGuests }
        : {}),
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

export const CALENDAR_EVENT_RECORD = "calendar_event";
const MAX_EVENT_REPLACE_ATTEMPTS = 3;
const TIME_WITH_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

const REPEATABLE_EVENT_FIELDS = new Set<string>([
  "title",
  "description",
  "location",
  "start",
  "end",
  "startTimeZone",
  "endTimeZone",
  "allDay",
  "transparency",
  "visibility",
  "status",
  "colorId",
  "recurrence",
]);

function sameEventTime(a: string, b: string, allDay: boolean): boolean {
  if (allDay) return a.split("T")[0] === b.split("T")[0];
  if (!TIME_WITH_OFFSET.test(a) || !TIME_WITH_OFFSET.test(b)) return a === b;
  return Date.parse(a) === Date.parse(b);
}

function eventHoldsPatch(
  current: CalendarEvent,
  patch: Partial<CalendarEvent>,
): boolean {
  const allDay = patch.allDay ?? current.allDay;
  const stored: Record<string, unknown> = { ...current };
  const fields: Record<string, unknown> = { ...patch };
  return Object.entries(fields).every(([key, value]) => {
    if (key === "accountEmail" || value === undefined) return true;
    if (!REPEATABLE_EVENT_FIELDS.has(key)) return false;
    const storedValue = stored[key] ?? (key === "recurrence" ? [] : null);
    if (
      (key === "start" || key === "end") &&
      typeof value === "string" &&
      typeof storedValue === "string"
    ) {
      return sameEventTime(value, storedValue, allDay);
    }
    return isSameRecord(value, storedValue);
  });
}

function eventConflict(current: CalendarEvent) {
  return saveConflict(CALENDAR_EVENT_RECORD, current, current.revision ?? null);
}

export interface EventUpdateResult {
  htmlLink?: string | undefined;
  meetLink?: string | undefined;
  conferenceData?: CalendarEvent["conferenceData"] | undefined;
  attendees?: CalendarEvent["attendees"] | undefined;
  revision?: string | undefined;
}

async function updateResultAfterStaleWrite(
  googleEventId: string,
  account: GoogleAccountSelection,
  resend: Partial<CalendarEvent> | undefined,
): Promise<EventUpdateResult> {
  const current = await getEvent(googleEventId, account);
  if (!resend || !eventHoldsPatch(current, resend)) {
    throw eventConflict(current);
  }
  countSaveOutcome(CALENDAR_EVENT_RECORD, "already_applied");
  return {
    htmlLink: current.htmlLink,
    meetLink: current.hangoutLink,
    conferenceData: current.conferenceData,
    attendees: current.attendees,
    revision: current.revision,
  };
}

export async function moveEvent(
  googleEventId: string,
  options: {
    sourceAccount: GoogleAccountSelection;
    destinationAccount: GoogleAccountSelection;
    sendUpdates?: "all" | "none";
    expectedRevision?: string | undefined;
  },
): Promise<{
  id?: string;
  htmlLink?: string;
  meetLink?: string;
  conferenceData?: CalendarEvent["conferenceData"];
}> {
  const sourceEvent = await getEvent(googleEventId, options.sourceAccount);
  checkSaveRevision({
    record: CALENDAR_EVENT_RECORD,
    expectedRevision: options.expectedRevision,
    current: { value: sourceEvent, revision: sourceEvent.revision ?? null },
    isSameSave: () => false,
  });
  if (sourceEvent.status === "cancelled") {
    throw new Error("Cancelled events cannot be moved.");
  }
  if (
    sourceEvent.eventType &&
    !["default", "outOfOffice", "focusTime", "workingLocation"].includes(
      sourceEvent.eventType,
    )
  ) {
    throw new Error("This Google Calendar event type cannot be moved.");
  }
  if (sourceEvent.recurrence?.length && !sourceEvent.recurringEventId) {
    throw new Error(
      "Recurring series masters cannot be moved; move a single occurrence instead.",
    );
  }

  const replacement = await createEvent(
    {
      ...sourceEvent,
      id: "",
      googleEventId: undefined,
      recurringEventId: undefined,
      accountEmail: options.destinationAccount.accountEmail,
      attendees: sourceEvent.attendees?.filter((attendee) => !attendee.self),
    },
    {
      account: options.destinationAccount,
      addGoogleMeet: Boolean(
        sourceEvent.hangoutLink ||
        sourceEvent.conferenceData?.entryPoints?.some(
          (entry) => entry.entryPointType === "video",
        ),
      ),
      sendUpdates: options.sendUpdates,
    },
  );

  if (!replacement.id) {
    throw new Error("Google did not return an id for the moved event.");
  }

  try {
    await deleteEvent(googleEventId, options.sourceAccount, {
      scope: "single",
      sendUpdates: options.sendUpdates,
      ifMatch: sourceEvent.revision,
    });
  } catch (error) {
    try {
      await deleteEvent(replacement.id, options.destinationAccount, {
        scope: "single",
        sendUpdates: options.sendUpdates === "all" ? "all" : "none",
      });
    } catch (cleanupError) {
      throw new CalendarMoveRollbackError(
        replacement.id,
        options.destinationAccount.accountEmail,
        cleanupError,
      );
    }
    throw error;
  }

  return replacement;
}

export async function updateEvent(
  googleEventId: string,
  event: Partial<CalendarEvent>,
  options: {
    account: GoogleAccountSelection;
    sendUpdates?: "all" | "none" | undefined;
    addGoogleMeet?: boolean | undefined;
    removeGoogleMeet?: boolean | undefined;
    scope?: UpdateEventScope | undefined;
    expectedRevision?: string | undefined;
  },
): Promise<EventUpdateResult> {
  const client = await getClientForAccount(options.account);

  let targetEventId = googleEventId;
  let eventPatch = event;
  let ifMatch = options.expectedRevision;
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
    if (
      options.expectedRevision !== undefined &&
      recurringEventId !== googleEventId
    ) {
      const occurrence = await calendarGetEvent(
        client.accessToken,
        "primary",
        googleEventId,
      );
      if (occurrence.etag !== options.expectedRevision) {
        throw eventConflict(await getEvent(googleEventId, options.account));
      }
      ifMatch = master.etag;
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
  if (
    eventPatch.location !== undefined &&
    eventPatch.workingLocationProperties === undefined
  )
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
      ...(a.comment ? { comment: a.comment } : {}),
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
      ...(a.optional === true ? { optional: true } : { optional: false }),
      ...(a.additionalGuests !== undefined
        ? { additionalGuests: a.additionalGuests }
        : {}),
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
  } else if (options?.removeGoogleMeet) {
    requestBody.conferenceData = null;
  }

  const writeParams = {
    sendUpdates: options.sendUpdates,
    conferenceDataVersion:
      options.addGoogleMeet || options.removeGoogleMeet ? 1 : undefined,
    supportsAttachments:
      eventPatch.attachments !== undefined ? true : undefined,
  };
  const replaceStoredEvent = async () => {
    for (let attempt = 1; ; attempt++) {
      const stored = await calendarGetEvent(
        client.accessToken,
        "primary",
        targetEventId,
      );
      try {
        return await calendarUpdateEvent(
          client.accessToken,
          "primary",
          targetEventId,
          { ...stored, ...requestBody },
          { ...writeParams, ifMatch: ifMatch ?? stored.etag },
        );
      } catch (error) {
        if (
          ifMatch !== undefined ||
          attempt >= MAX_EVENT_REPLACE_ATTEMPTS ||
          !isGooglePreconditionFailedError(error)
        ) {
          throw error;
        }
      }
    }
  };

  let response: Awaited<ReturnType<typeof calendarPatchEvent>>;
  try {
    response = eventPatch.workingLocationProperties
      ? await replaceStoredEvent()
      : await calendarPatchEvent(
          client.accessToken,
          "primary",
          targetEventId,
          requestBody,
          { ...writeParams, ifMatch },
        );
  } catch (error) {
    if (ifMatch === undefined || !isGooglePreconditionFailedError(error)) {
      throw error;
    }
    const resend =
      targetEventId === googleEventId &&
      !options.addGoogleMeet &&
      !options.removeGoogleMeet
        ? event
        : undefined;
    return updateResultAfterStaleWrite(googleEventId, options.account, resend);
  }

  return {
    revision:
      targetEventId === googleEventId ? response?.etag || undefined : undefined,
    htmlLink: response?.htmlLink || undefined,
    meetLink: response?.hangoutLink || undefined,
    conferenceData: mapConferenceData(response?.conferenceData),
    attendees: response?.attendees?.map((a: any) => ({
      email: a.email,
      displayName: a.displayName || undefined,
      comment: a.comment || undefined,
      responseStatus: a.responseStatus || undefined,
      organizer: a.organizer || undefined,
      self: a.self || undefined,
      optional: a.optional === true ? true : undefined,
      additionalGuests:
        typeof a.additionalGuests === "number" && a.additionalGuests > 0
          ? a.additionalGuests
          : undefined,
    })),
  };
}

export async function deleteEvent(
  googleEventId: string,
  account: GoogleAccountSelection,
  options?: {
    scope?: "single" | "all" | "thisAndFollowing";
    sendUpdates?: "all" | "none";
    ifMatch?: string | undefined;
  },
): Promise<void> {
  const client = await getClientForAccount(account);

  const scope = options?.scope || "single";
  const sendUpdates = options?.sendUpdates;

  if (scope === "single") {
    try {
      await calendarDeleteEvent(
        client.accessToken,
        "primary",
        googleEventId,
        sendUpdates,
        options?.ifMatch,
      );
    } catch (error) {
      if (
        options?.ifMatch === undefined ||
        !isGooglePreconditionFailedError(error)
      ) {
        throw error;
      }
      throw eventConflict(await getEvent(googleEventId, account));
    }
    return;
  }

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

  if (recurringEventId === googleEventId) {
    await calendarDeleteEvent(
      client.accessToken,
      "primary",
      googleEventId,
      sendUpdates,
    );
    return;
  }

  const instanceStart =
    instance.originalStartTime?.dateTime ||
    instance.originalStartTime?.date ||
    instance.start?.dateTime ||
    instance.start?.date ||
    "";
  const isAllDay =
    !instance.originalStartTime?.dateTime && !instance.start?.dateTime;

  const cutoff = new Date(instanceStart);
  cutoff.setDate(cutoff.getDate() - 1);

  let untilStr: string;
  if (isAllDay) {
    untilStr = cutoff.toISOString().slice(0, 10).replace(/-/g, "");
  } else {
    cutoff.setUTCHours(23, 59, 59, 0);
    untilStr = cutoff.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  }

  const master = await calendarGetEvent(
    client.accessToken,
    "primary",
    recurringEventId,
  );
  const recurrence: string[] = master.recurrence || [];
  const updatedRecurrence = recurrence.map((rule: string) => {
    if (rule.startsWith("RRULE:")) {
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

  const instanceStartMs = Date.parse(instanceStart);
  const exceptionIds = new Set<string>([googleEventId]);
  let pageToken: string | undefined;
  do {
    const response = await calendarListEvents(client.accessToken, "primary", {
      singleEvents: false,
      showDeleted: true,
      maxResults: 2500,
      pageToken,
    });
    for (const event of response?.items || []) {
      if (event.recurringEventId !== recurringEventId) continue;
      const originalStart =
        event.originalStartTime?.dateTime ||
        event.originalStartTime?.date ||
        event.start?.dateTime ||
        event.start?.date;
      const originalStartMs =
        typeof originalStart === "string" ? Date.parse(originalStart) : NaN;
      if (
        event.id &&
        Number.isFinite(instanceStartMs) &&
        Number.isFinite(originalStartMs) &&
        originalStartMs >= instanceStartMs
      ) {
        exceptionIds.add(event.id);
      }
    }
    pageToken =
      typeof response?.nextPageToken === "string"
        ? response.nextPageToken
        : undefined;
  } while (pageToken);

  for (const eventId of exceptionIds) {
    try {
      await calendarDeleteEvent(
        client.accessToken,
        "primary",
        eventId,
        sendUpdates,
      );
    } catch (error) {
      if (!isGoogleEventAbsentError(error)) throw error;
    }
  }
}

export async function removeEventFromCalendar(
  googleEventId: string,
  account: GoogleAccountSelection,
  options?: {
    scope?: "single" | "all" | "thisAndFollowing";
    sendUpdates?: "all" | "none";
  },
): Promise<void> {
  const client = await getClientForAccount(account);

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

  await calendarDeleteEvent(
    client.accessToken,
    "primary",
    googleEventId,
    sendUpdates,
  );
}

async function rsvpSingleEvent(
  accessToken: string,
  eventId: string,
  responseStatus: string,
  accountEmail: string,
  comment?: string,
  sendUpdates?: string,
  signal?: AbortSignal,
): Promise<void> {
  await calendarPatchEvent(
    accessToken,
    "primary",
    eventId,
    {
      attendees: [
        {
          email: accountEmail,
          responseStatus,
          ...(comment !== undefined ? { comment } : {}),
        },
      ],
      attendeesOmitted: true,
    },
    { sendUpdates: sendUpdates ?? "none" },
    signal,
  );
}

export async function rsvpEvent(
  googleEventId: string,
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction",
  account: GoogleAccountSelection,
  scope: "single" | "all" | "thisAndFollowing" = "single",
  comment?: string,
  sendUpdates?: string,
  signal?: AbortSignal,
): Promise<void> {
  const client = await getClientForAccount(account);
  signal?.throwIfAborted();

  if (scope === "single") {
    await rsvpSingleEvent(
      client.accessToken,
      googleEventId,
      responseStatus,
      account.accountEmail,
      comment,
      sendUpdates,
      signal,
    );
    return;
  }

  const instance = await calendarGetEvent(
    client.accessToken,
    "primary",
    googleEventId,
    signal,
  );
  signal?.throwIfAborted();
  const recurringEventId = instance.recurringEventId || googleEventId;

  if (scope === "all") {
    await rsvpSingleEvent(
      client.accessToken,
      recurringEventId,
      responseStatus,
      account.accountEmail,
      comment,
      sendUpdates,
      signal,
    );
    return;
  }

  const instanceStart =
    instance.start?.dateTime ||
    instance.start?.date ||
    new Date().toISOString();

  const futureEvents = await calendarListEvents(
    client.accessToken,
    "primary",
    {
      timeMin: instanceStart,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    },
    signal,
  );
  signal?.throwIfAborted();

  const futureInstances = (futureEvents.items || []).filter(
    (e: any) =>
      e.recurringEventId === recurringEventId || e.id === recurringEventId,
  );

  await Promise.all(
    futureInstances.map((e: any) =>
      rsvpSingleEvent(
        client.accessToken,
        e.id,
        responseStatus,
        account.accountEmail,
        comment,
        sendUpdates,
        signal,
      ),
    ),
  );
}
