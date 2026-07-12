import { Buffer } from "node:buffer";

import { readAppSecret, writeAppSecret } from "@agent-native/core/secrets";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  detectPlatform,
  getEvent,
  isPermanentRefreshFailure,
  pickJoinUrl,
  resolveGoogleOAuthCredentialCandidates,
  refreshAccessTokenWithFallback,
  type CalendarEvent,
} from "./google-calendar-client.js";
import {
  getActiveOrganizationId,
  getCurrentOwnerEmail,
  nanoid,
} from "./recordings.js";

export const CALENDAR_MEETING_ID_PREFIX = "gcal";

export interface CalendarAccountForEvents {
  id: string;
  provider: string;
  ownerEmail?: string | null;
  orgId?: string | null;
  accessTokenSecretRef?: string | null;
  refreshTokenSecretRef?: string | null;
}

export interface CalendarFetchError {
  accountId: string;
  error: string;
  needsReauth: boolean;
}

interface AccessTokenBundle {
  accessToken: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

function parseAccessBundle(raw: string): AccessTokenBundle {
  try {
    const parsed = JSON.parse(raw) as AccessTokenBundle;
    if (parsed && typeof parsed.accessToken === "string") return parsed;
  } catch {
    // Older shape: raw token string.
  }
  return { accessToken: raw };
}

export function eventStartIso(event: CalendarEvent): string | null {
  return event.start?.dateTime || event.start?.date || null;
}

export function eventEndIso(event: CalendarEvent): string | null {
  return event.end?.dateTime || event.end?.date || null;
}

export function isTimedCalendarEvent(event: CalendarEvent): boolean {
  return !!(event.start?.dateTime && event.end?.dateTime);
}

export function shouldMarkNeedsReauth(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("google calendar list failed (401)") ||
    lower.includes("google calendar event failed (401)") ||
    lower.includes("invalid_grant") ||
    lower.includes("invalid_token") ||
    lower.includes("insufficient_scope") ||
    lower.includes("token refresh failed")
  );
}

export async function resolveCalendarAccessToken(
  account: CalendarAccountForEvents,
): Promise<string | null> {
  const credentialCandidates = resolveGoogleOAuthCredentialCandidates();
  if (!credentialCandidates.length || !account.ownerEmail) return null;

  let bundle: AccessTokenBundle | null = null;
  if (account.accessTokenSecretRef) {
    const stored = await readAppSecret({
      key: account.accessTokenSecretRef,
      scope: "user",
      scopeId: account.ownerEmail,
    });
    if (stored?.value) bundle = parseAccessBundle(stored.value);
  }

  if (
    bundle?.accessToken &&
    bundle.expiresAt &&
    Date.now() < bundle.expiresAt - 5 * 60 * 1000
  ) {
    return bundle.accessToken;
  }
  if (bundle?.accessToken && !bundle.expiresAt) {
    return bundle.accessToken;
  }

  if (!account.refreshTokenSecretRef) return null;
  const refreshSecret = await readAppSecret({
    key: account.refreshTokenSecretRef,
    scope: "user",
    scopeId: account.ownerEmail,
  });
  if (!refreshSecret?.value) return null;

  let refreshed;
  try {
    refreshed = await refreshAccessTokenWithFallback({
      refreshToken: refreshSecret.value,
      credentials: credentialCandidates,
    });
  } catch (err) {
    // Only a permanent failure (dead refresh token / bad OAuth client) means
    // "needs-reauth" — collapse those to `null` as before. A transient
    // failure (network error, 429, 5xx, timeout) is rethrown so callers can
    // record it as a soft sync error without flipping account status.
    if (isPermanentRefreshFailure(err)) return null;
    throw err;
  }
  if (!refreshed.access_token) return null;
  if (account.accessTokenSecretRef) {
    await writeAppSecret({
      key: account.accessTokenSecretRef,
      value: JSON.stringify({
        accessToken: refreshed.access_token,
        expiresAt: refreshed.expires_in
          ? Date.now() + refreshed.expires_in * 1000
          : undefined,
        tokenType: refreshed.token_type,
        scope: refreshed.scope,
      }),
      scope: "user",
      scopeId: account.ownerEmail,
    });
  }
  return refreshed.access_token;
}

export async function recordCalendarFetchSuccess(
  account: CalendarAccountForEvents,
) {
  if (!account.ownerEmail) return;
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .update(schema.calendarAccounts)
    .set({
      lastSyncedAt: now,
      lastSyncError: null,
      status: "connected",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.calendarAccounts.id, account.id),
        eq(schema.calendarAccounts.ownerEmail, account.ownerEmail),
      ),
    );
}

export async function recordCalendarFetchError(
  account: CalendarAccountForEvents,
  error: unknown,
): Promise<CalendarFetchError> {
  const message =
    error instanceof Error ? error.message : String(error || "Calendar failed");
  const needsReauth = shouldMarkNeedsReauth(message);
  if (!account.ownerEmail) {
    return { accountId: account.id, error: message, needsReauth };
  }
  const db = getDb();
  await db
    .update(schema.calendarAccounts)
    .set({
      status: needsReauth ? "needs-reauth" : "connected",
      lastSyncError: needsReauth
        ? "Google Calendar needs to be reconnected."
        : message,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.calendarAccounts.id, account.id),
        eq(schema.calendarAccounts.ownerEmail, account.ownerEmail),
      ),
    )
    .catch((writeErr: any) => {
      console.warn(
        `[calendar] failed to record calendar error for ${account.id}:`,
        writeErr?.message ?? writeErr,
      );
    });
  return { accountId: account.id, error: message, needsReauth };
}

export function encodeCalendarMeetingId(
  accountId: string,
  externalId: string,
): string {
  const encoded = Buffer.from(externalId, "utf8").toString("base64url");
  return `${CALENDAR_MEETING_ID_PREFIX}_${accountId}_${encoded}`;
}

export function parseCalendarMeetingId(
  id: string,
): { accountId: string; externalId: string } | null {
  const match = new RegExp(`^${CALENDAR_MEETING_ID_PREFIX}_([^_]+)_(.+)$`).exec(
    id,
  );
  if (!match) return null;
  try {
    return {
      accountId: match[1],
      externalId: Buffer.from(match[2], "base64url").toString("utf8"),
    };
  } catch {
    return null;
  }
}

export function calendarEventParticipants(event: CalendarEvent) {
  return (event.attendees ?? [])
    .filter((a) => a.email)
    .map((a) => ({
      email: a.email!,
      name: a.displayName,
      responseStatus: a.responseStatus,
      isOrganizer: a.email === event.organizer?.email,
    }));
}

export function calendarEventToMeetingView(args: {
  account: CalendarAccountForEvents;
  event: CalendarEvent;
  meeting?: any | null;
}) {
  const startIso = eventStartIso(args.event);
  const endIso = eventEndIso(args.event);
  if (!args.event.id || !startIso || !endIso) return null;
  const joinUrl = pickJoinUrl(args.event);
  const meeting = args.meeting;
  const summary = (meeting?.summaryMd ?? "").trim();
  return {
    ...(meeting ?? {}),
    id: meeting?.id ?? encodeCalendarMeetingId(args.account.id, args.event.id),
    title: meeting?.title || args.event.summary || "Untitled event",
    scheduledStart: startIso,
    scheduledEnd: endIso,
    actualStart: meeting?.actualStart ?? null,
    actualEnd: meeting?.actualEnd ?? null,
    platform: meeting?.platform ?? detectPlatform(joinUrl),
    joinUrl: meeting?.joinUrl ?? joinUrl ?? null,
    source: "calendar",
    recordingId: meeting?.recordingId ?? null,
    transcriptStatus: meeting?.transcriptStatus ?? "idle",
    summaryMd: meeting?.summaryMd ?? "",
    summaryPreview: summary ? summary.replace(/\s+/g, " ").slice(0, 100) : null,
    userNotesMd: meeting?.userNotesMd ?? "",
    reminderFiredAt: meeting?.reminderFiredAt ?? null,
    participants: calendarEventParticipants(args.event),
    calendarAccountId: args.account.id,
    calendarExternalId: args.event.id,
    isVirtualCalendarEvent: !meeting,
  };
}

export async function fetchLiveCalendarEventFromId(virtualId: string) {
  const parsed = parseCalendarMeetingId(virtualId);
  if (!parsed) return null;
  const access = await resolveAccess("calendar-account", parsed.accountId);
  if (!access) return null;

  const db = getDb();
  const [account] = await db
    .select()
    .from(schema.calendarAccounts)
    .where(eq(schema.calendarAccounts.id, parsed.accountId))
    .limit(1);
  if (!account || account.provider !== "google") return null;

  let accessToken: string | null;
  try {
    accessToken = await resolveCalendarAccessToken(account);
  } catch (err) {
    // Transient refresh failure — record the real error (won't match
    // shouldMarkNeedsReauth) instead of a permanent needs-reauth marker.
    await recordCalendarFetchError(account, err);
    return null;
  }
  if (!accessToken) {
    await recordCalendarFetchError(account, new Error("Token refresh failed"));
    return null;
  }

  try {
    const event = await getEvent({
      accessToken,
      calendarId: "primary",
      eventId: parsed.externalId,
    });
    if (event.status === "cancelled") return null;
    await recordCalendarFetchSuccess(account).catch(() => {});
    return { account, event };
  } catch (err) {
    await recordCalendarFetchError(account, err);
    return null;
  }
}

export async function upsertCalendarEventSnapshot(args: {
  account: CalendarAccountForEvents;
  event: CalendarEvent;
}) {
  const db = getDb();
  const startIso = eventStartIso(args.event);
  const endIso = eventEndIso(args.event);
  if (!args.event.id || !startIso || !endIso) {
    throw new Error("Calendar event is missing a start or end time.");
  }
  const attendees = calendarEventParticipants(args.event);
  const joinUrl = pickJoinUrl(args.event);
  const nowIso = new Date().toISOString();
  const [existing] = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.calendarAccountId, args.account.id),
        eq(schema.calendarEvents.externalId, args.event.id),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.calendarEvents)
      .set({
        title: args.event.summary ?? "",
        description: args.event.description ?? "",
        start: startIso,
        end: endIso,
        organizerEmail: args.event.organizer?.email ?? null,
        joinUrl: joinUrl ?? null,
        location: args.event.location ?? null,
        attendeesJson: JSON.stringify(attendees),
        providerUpdatedAt: args.event.updated ?? null,
        updatedAt: nowIso,
      })
      .where(eq(schema.calendarEvents.id, existing.id));
    return { ...existing, start: startIso, end: endIso, joinUrl };
  }

  const id = nanoid();
  await db.insert(schema.calendarEvents).values({
    id,
    calendarAccountId: args.account.id,
    externalId: args.event.id,
    title: args.event.summary ?? "",
    description: args.event.description ?? "",
    start: startIso,
    end: endIso,
    organizerEmail: args.event.organizer?.email ?? null,
    joinUrl: joinUrl ?? null,
    location: args.event.location ?? null,
    attendeesJson: JSON.stringify(attendees),
    providerUpdatedAt: args.event.updated ?? null,
    meetingId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  } as any);

  return {
    id,
    calendarAccountId: args.account.id,
    externalId: args.event.id,
    title: args.event.summary ?? "",
    start: startIso,
    end: endIso,
    joinUrl,
    meetingId: null,
  };
}

export async function materializeCalendarMeetingFromVirtualId(
  virtualId: string,
) {
  const live = await fetchLiveCalendarEventFromId(virtualId);
  if (!live) return null;
  const db = getDb();
  const snapshot = await upsertCalendarEventSnapshot(live);

  if (snapshot.meetingId) {
    const [existingMeeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, snapshot.meetingId))
      .limit(1);
    if (existingMeeting) return { meeting: existingMeeting, created: false };
  }

  const ownerEmail = getCurrentOwnerEmail();
  const orgId = (await getActiveOrganizationId().catch(() => null)) ?? null;
  const joinUrl = pickJoinUrl(live.event);
  const meetingId = nanoid();
  const nowIso = new Date().toISOString();

  // Claim the calendar_events row atomically before inserting the meeting
  // row, so two concurrent materialize calls for the same event can't both
  // insert a `meetings` row (check-then-act TOCTOU). Only the caller whose
  // UPDATE actually matched a row (meetingId still NULL) proceeds to insert;
  // the loser re-reads and returns the winner's meeting instead.
  const claimed = await db
    .update(schema.calendarEvents)
    .set({ meetingId, updatedAt: nowIso })
    .where(
      and(
        eq(schema.calendarEvents.id, snapshot.id),
        isNull(schema.calendarEvents.meetingId),
      ),
    )
    .returning({ id: schema.calendarEvents.id });

  if (!claimed.length) {
    // Someone else claimed it first — re-read and return their meeting.
    const [winnerEvent] = await db
      .select({ meetingId: schema.calendarEvents.meetingId })
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, snapshot.id))
      .limit(1);
    if (winnerEvent?.meetingId) {
      const [winnerMeeting] = await db
        .select()
        .from(schema.meetings)
        .where(eq(schema.meetings.id, winnerEvent.meetingId))
        .limit(1);
      if (winnerMeeting) return { meeting: winnerMeeting, created: false };
    }
    return null;
  }

  try {
    await db.insert(schema.meetings).values({
      id: meetingId,
      organizationId: orgId ?? live.account.orgId ?? null,
      title: live.event.summary || "Untitled meeting",
      scheduledStart: eventStartIso(live.event),
      scheduledEnd: eventEndIso(live.event),
      actualStart: null,
      actualEnd: null,
      platform: detectPlatform(joinUrl),
      joinUrl: joinUrl ?? null,
      calendarEventId: snapshot.id,
      recordingId: null,
      transcriptStatus: "idle",
      summaryMd: "",
      bulletsJson: "[]",
      actionItemsJson: "[]",
      source: "calendar",
      reminderFiredAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      ownerEmail,
      orgId,
      visibility: "private",
    } as any);

    const participants = calendarEventParticipants(live.event).filter(
      (p) => p.email,
    );
    if (participants.length) {
      await db.insert(schema.meetingParticipants).values(
        participants.map((p) => ({
          id: nanoid(),
          meetingId,
          email: p.email,
          name: p.name ?? null,
          isOrganizer: !!p.isOrganizer,
          attendedAt: null,
          createdAt: nowIso,
        })) as any,
      );
    }
  } catch (err) {
    // Roll back the claim so a future call can retry — but only if it still
    // points at our own meetingId (don't clobber a legitimate later claim).
    await db
      .update(schema.calendarEvents)
      .set({ meetingId: null, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.calendarEvents.id, snapshot.id),
          eq(schema.calendarEvents.meetingId, meetingId),
        ),
      )
      .catch(() => {});
    throw err;
  }

  const [meeting] = await db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.id, meetingId))
    .limit(1);

  return { meeting, created: true };
}
