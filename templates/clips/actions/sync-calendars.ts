/**
 * sync-calendars
 *
 * Pulls events for all calendar accounts visible to the current user
 * (or, when invoked from a recurring job, every connected account).
 * Upserts events into `calendar_events`. Auto-creates `meetings` rows
 * for events with a join URL whose start falls in the next 14 days.
 *
 * Tokens are read from `app_secrets`; we refresh on demand and write
 * the new access token back. Tokens never touch the calendar_accounts
 * row.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { accessFilter } from "@agent-native/core/sharing";
import { readAppSecret, writeAppSecret } from "@agent-native/core/secrets";
import {
  listEvents,
  refreshAccessToken,
  pickJoinUrl,
  detectPlatform,
  type CalendarEvent,
} from "../server/lib/google-calendar-client.js";
import { writeAppState } from "@agent-native/core/application-state";
import { emit } from "@agent-native/core/event-bus";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

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
    // older shape: raw token string
  }
  return { accessToken: raw };
}

/**
 * Resolve a fresh access token, refreshing via Google if expired.
 * Returns null if the account is unrecoverable (no refresh token,
 * permanent refresh failure).
 */
async function resolveAccessToken(args: {
  ownerEmail: string;
  accessRef: string | null;
  refreshRef: string | null;
}): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  let bundle: AccessTokenBundle | null = null;
  if (args.accessRef) {
    const stored = await readAppSecret({
      key: args.accessRef,
      scope: "user",
      scopeId: args.ownerEmail,
    });
    if (stored?.value) bundle = parseAccessBundle(stored.value);
  }

  // Token is fresh enough → use as-is (5 min skew).
  if (
    bundle?.accessToken &&
    bundle.expiresAt &&
    Date.now() < bundle.expiresAt - 5 * 60 * 1000
  ) {
    return bundle.accessToken;
  }
  if (bundle?.accessToken && !bundle.expiresAt) {
    // Unknown expiry — try once and let the caller retry on 401 if needed.
    return bundle.accessToken;
  }

  // Refresh path.
  if (!args.refreshRef) return null;
  const refreshSecret = await readAppSecret({
    key: args.refreshRef,
    scope: "user",
    scopeId: args.ownerEmail,
  });
  if (!refreshSecret?.value) return null;

  let refreshed;
  try {
    refreshed = await refreshAccessToken({
      refreshToken: refreshSecret.value,
      clientId,
      clientSecret,
    });
  } catch {
    return null;
  }
  if (!refreshed.access_token) return null;
  if (args.accessRef) {
    await writeAppSecret({
      key: args.accessRef,
      value: JSON.stringify({
        accessToken: refreshed.access_token,
        expiresAt: refreshed.expires_in
          ? Date.now() + refreshed.expires_in * 1000
          : undefined,
        tokenType: refreshed.token_type,
        scope: refreshed.scope,
      }),
      scope: "user",
      scopeId: args.ownerEmail,
    });
  }
  return refreshed.access_token;
}

function eventStartIso(event: CalendarEvent): string | null {
  return event.start?.dateTime || event.start?.date || null;
}

function eventEndIso(event: CalendarEvent): string | null {
  return event.end?.dateTime || event.end?.date || null;
}

export default defineAction({
  description:
    "Pull the latest events from connected calendars and upsert them. Auto-creates meeting rows from events with a join URL starting within the next 14 days.",
  schema: z.object({
    accountId: z
      .string()
      .optional()
      .describe(
        "If set, only sync this calendar_accounts row. Otherwise sync every account visible to the current user.",
      ),
    /**
     * Internal flag used by the recurring `poll-calendars` job — when set,
     * the action ignores the access filter and syncs every connected
     * account on the system. Tokens are still scoped per-account-owner.
     */
    allAccounts: z.boolean().default(false),
  }),
  run: async (args) => {
    const db = getDb();
    const where = args.allAccounts
      ? []
      : [accessFilter(schema.calendarAccounts, schema.calendarAccountShares)];
    if (args.accountId) {
      where.push(eq(schema.calendarAccounts.id, args.accountId));
    }
    where.push(eq(schema.calendarAccounts.status, "connected"));

    const accounts = await db
      .select()
      .from(schema.calendarAccounts)
      .where(where.length ? and(...where) : undefined);

    const now = new Date();
    // Sync window: 1h ago to 30 days out.
    const timeMin = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const timeMax = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    let totalEvents = 0;
    let totalMeetings = 0;
    const errors: { accountId: string; error: string }[] = [];

    for (const account of accounts) {
      if (account.provider !== "google") continue; // iCloud / Microsoft handled elsewhere.
      if (!account.ownerEmail) continue;
      // Track per-account event counts so we can emit a `calendar-synced`
      // event with accurate numbers after each account finishes (Fix 7).
      let perAccountEvents = 0;
      let perAccountMeetings = 0;
      try {
        const accessToken = await resolveAccessToken({
          ownerEmail: account.ownerEmail,
          accessRef: account.accessTokenSecretRef ?? null,
          refreshRef: account.refreshTokenSecretRef ?? null,
        });
        if (!accessToken) {
          // Fix 10: isolate this account's needs-reauth write in its own
          // try/catch so a downstream throw on a different account doesn't
          // leave the flag unpersisted.
          try {
            await db
              .update(schema.calendarAccounts)
              .set({
                status: "needs-reauth",
                lastSyncError: "Token refresh failed — reconnect required.",
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.calendarAccounts.id, account.id));
          } catch (writeErr: any) {
            console.warn(
              `[sync-calendars] failed to flag account ${account.id} as needs-reauth:`,
              writeErr?.message ?? writeErr,
            );
          }
          errors.push({
            accountId: account.id,
            error: "needs-reauth",
          });
          continue;
        }

        const { items } = await listEvents({
          accessToken,
          calendarId: "primary",
          timeMin,
          timeMax,
          maxResults: 250,
        });

        // Upsert events.
        for (const ev of items) {
          if (!ev.id) continue;
          if (ev.status === "cancelled") {
            // Delete cancelled events from our cache.
            await db
              .delete(schema.calendarEvents)
              .where(
                and(
                  eq(schema.calendarEvents.calendarAccountId, account.id),
                  eq(schema.calendarEvents.externalId, ev.id),
                ),
              );
            continue;
          }
          const startIso = eventStartIso(ev);
          const endIso = eventEndIso(ev);
          if (!startIso || !endIso) continue;
          const joinUrl = pickJoinUrl(ev);
          const attendees = (ev.attendees ?? []).map((a) => ({
            email: a.email ?? "",
            name: a.displayName,
            responseStatus: a.responseStatus,
          }));
          const nowIso = new Date().toISOString();

          const [existing] = await db
            .select({ id: schema.calendarEvents.id })
            .from(schema.calendarEvents)
            .where(
              and(
                eq(schema.calendarEvents.calendarAccountId, account.id),
                eq(schema.calendarEvents.externalId, ev.id),
              ),
            );

          if (existing) {
            await db
              .update(schema.calendarEvents)
              .set({
                title: ev.summary ?? "",
                description: ev.description ?? "",
                start: startIso,
                end: endIso,
                organizerEmail: ev.organizer?.email ?? null,
                joinUrl: joinUrl ?? null,
                location: ev.location ?? null,
                attendeesJson: JSON.stringify(attendees),
                providerUpdatedAt: ev.updated ?? null,
                updatedAt: nowIso,
              })
              .where(eq(schema.calendarEvents.id, existing.id));
          } else {
            await db.insert(schema.calendarEvents).values({
              id: randomUUID(),
              calendarAccountId: account.id,
              externalId: ev.id,
              title: ev.summary ?? "",
              description: ev.description ?? "",
              start: startIso,
              end: endIso,
              organizerEmail: ev.organizer?.email ?? null,
              joinUrl: joinUrl ?? null,
              location: ev.location ?? null,
              attendeesJson: JSON.stringify(attendees),
              providerUpdatedAt: ev.updated ?? null,
              meetingId: null,
              createdAt: nowIso,
              updatedAt: nowIso,
            } as any);
          }
          totalEvents += 1;
          perAccountEvents += 1;
        }

        // Auto-create meetings rows for events with joinUrl + start in [now, +14d]
        // that don't already have a linked meeting.
        const fourteenOut = new Date(
          now.getTime() + FOURTEEN_DAYS_MS,
        ).toISOString();
        const candidates = await db
          .select()
          .from(schema.calendarEvents)
          .where(and(eq(schema.calendarEvents.calendarAccountId, account.id)));
        const candidateIds = candidates
          .filter(
            (e) =>
              !!e.joinUrl &&
              !e.meetingId &&
              e.start >= now.toISOString() &&
              e.start <= fourteenOut,
          )
          .map((e) => e.id);

        // Bulk lookup of any pre-existing meetings keyed off externalId is
        // unnecessary — we use the meetingId column on calendar_events as
        // the dedup key.
        for (const evRow of candidates.filter((e) =>
          candidateIds.includes(e.id),
        )) {
          const meetingId = randomUUID();
          const platform = detectPlatform(evRow.joinUrl ?? undefined);
          const meetingNow = new Date().toISOString();
          await db.insert(schema.meetings).values({
            id: meetingId,
            organizationId: account.orgId ?? null,
            title: evRow.title || "Untitled meeting",
            scheduledStart: evRow.start,
            scheduledEnd: evRow.end,
            platform,
            joinUrl: evRow.joinUrl ?? null,
            calendarEventId: evRow.id,
            source: "calendar",
            createdAt: meetingNow,
            updatedAt: meetingNow,
            ownerEmail: account.ownerEmail,
            visibility: "private",
          } as any);

          // Seed participants from attendees.
          try {
            const attendees = JSON.parse(evRow.attendeesJson) as Array<{
              email?: string;
              name?: string;
              responseStatus?: string;
            }>;
            if (Array.isArray(attendees) && attendees.length) {
              await db.insert(schema.meetingParticipants).values(
                attendees
                  .filter((a) => a.email)
                  .map((a) => ({
                    id: randomUUID(),
                    meetingId,
                    email: a.email!,
                    name: a.name ?? null,
                    isOrganizer: a.email === evRow.organizerEmail,
                    attendedAt: null,
                    createdAt: meetingNow,
                  })) as any,
              );
            }
          } catch {
            // Skip participant seeding on JSON parse error.
          }

          await db
            .update(schema.calendarEvents)
            .set({ meetingId })
            .where(eq(schema.calendarEvents.id, evRow.id));
          totalMeetings += 1;
          perAccountMeetings += 1;
        }

        // Fix 10: isolate the success-path status write so other accounts'
        // needs-reauth flags can't be wiped by a later account-level throw.
        try {
          await db
            .update(schema.calendarAccounts)
            .set({
              lastSyncedAt: new Date().toISOString(),
              lastSyncError: null,
              status: "connected",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.calendarAccounts.id, account.id));
        } catch (writeErr: any) {
          console.warn(
            `[sync-calendars] failed to update account ${account.id} after success:`,
            writeErr?.message ?? writeErr,
          );
        }

        // Fix 7: emit `calendar-synced` so the UI can show a fresh-sync toast
        // (e.g. "Synced 12 events, 3 meetings just now"). Best-effort — the
        // event bus is in-process so this almost never throws, but we don't
        // want a subscriber crash to roll back the sync.
        try {
          emit("calendar-synced", {
            accountId: account.id,
            ownerEmail: account.ownerEmail,
            eventCount: perAccountEvents,
            meetingsCreated: perAccountMeetings,
            syncedAt: new Date().toISOString(),
          });
        } catch (emitErr: any) {
          console.warn(
            `[sync-calendars] calendar-synced emit failed for ${account.id}:`,
            emitErr?.message ?? emitErr,
          );
        }
      } catch (err: any) {
        const message = err?.message ?? String(err);
        errors.push({ accountId: account.id, error: message });
        // Fix 10: even the error-path write is its own try/catch.
        try {
          await db
            .update(schema.calendarAccounts)
            .set({
              lastSyncError: message.slice(0, 500),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.calendarAccounts.id, account.id));
        } catch (writeErr: any) {
          console.warn(
            `[sync-calendars] failed to record sync error for ${account.id}:`,
            writeErr?.message ?? writeErr,
          );
        }
      }
    }

    if (totalEvents || totalMeetings) {
      await writeAppState("refresh-signal", { ts: Date.now() });
    }
    return {
      synced: accounts.length,
      events: totalEvents,
      meetings: totalMeetings,
      errors,
    };
  },
});
