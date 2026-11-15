/**
 * The database side of huddle participants.
 *
 * Two ways in, one way to fill:
 * - a huddle message arrives (handleSlackHuddleEvent): store the huddle, then
 *   fill every Slack meeting of a connected participant that it could belong to;
 * - a Slack meeting stops (fillSlackHuddleParticipantsForMeeting): fill it from
 *   the huddles already stored.
 * Both re-pick the best huddle for the meeting from everything stored, so the
 * order the two arrive in does not matter, and the insert is idempotent.
 */
import { createHash, randomUUID } from "node:crypto";

import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "../db/schema.js";
import {
  buildHuddleParticipantRows,
  fetchSlackPerson,
  HUDDLE_LATE_JOIN_MAX_MS,
  HUDDLE_START_MATCH_WINDOW_MS,
  mergeSlackHuddles,
  parseSlackHuddleEvent,
  pickHuddleForMeeting,
  SlackTokenError,
  type SlackHuddle,
  type SlackPerson,
} from "./slack-huddles.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any schema works: only the tables below are touched.
export type HuddleDb = PgDatabase<PgQueryResultHKT, any>;

export type SlackUserConnection = {
  id: string;
  ownerEmail: string;
  teamId: string;
  slackUserId: string;
  tokenSecretRef: string;
};

export type HuddleMeeting = {
  id: string;
  ownerEmail: string;
  actualStart: string;
};

export type HuddleDeps = {
  db: HuddleDb;
  /**
   * The connection's decrypted Slack user token, or null when it is gone.
   * Throws when the token could not be read right now.
   */
  readToken: (connection: SlackUserConnection) => Promise<string | null>;
  /**
   * A huddle event matched a meeting: give the huddle's people access to what
   * the meeting already shared (it may have been stopped and shared before
   * they joined). Gets every huddle e-mail, not only new rows, so a retried
   * event can finish a share an earlier attempt could not.
   */
  onHuddleParticipants?: (meetingId: string, emails: string[]) => Promise<void>;
  fetchImpl?: typeof fetch;
};

/** users.info calls one huddle runs at once. */
const PROFILE_LOOKUP_CONCURRENCY = 8;

const connectionColumns = {
  id: schema.slackUserConnections.id,
  ownerEmail: schema.slackUserConnections.ownerEmail,
  teamId: schema.slackUserConnections.teamId,
  slackUserId: schema.slackUserConnections.slackUserId,
  tokenSecretRef: schema.slackUserConnections.tokenSecretRef,
};

function parseIds(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

type HuddleRow = typeof schema.slackHuddles.$inferSelect;

function rowToHuddle(row: HuddleRow): SlackHuddle {
  return {
    teamId: row.teamId,
    channelId: row.channelId,
    messageTs: row.messageTs,
    dateStart: Number(row.dateStart),
    dateEnd: row.dateEnd === null ? null : Number(row.dateEnd),
    startedBy: row.startedBy,
    participantIds: parseIds(row.participantIdsJson),
  };
}

/**
 * Store a huddle, merged with what an earlier message said about it.
 * Slack sends the first huddle message and its edits close together, so two
 * writes can race: the row is created if missing, then locked, merged with
 * what is stored now and written back in one transaction.
 */
export async function upsertSlackHuddle(
  db: HuddleDb,
  huddle: SlackHuddle,
  nowIso = new Date().toISOString(),
): Promise<SlackHuddle> {
  const key = and(
    eq(schema.slackHuddles.teamId, huddle.teamId),
    eq(schema.slackHuddles.channelId, huddle.channelId),
    eq(schema.slackHuddles.messageTs, huddle.messageTs),
  );
  return db.transaction(async (tx) => {
    await tx
      .insert(schema.slackHuddles)
      .values({
        id: randomUUID(),
        teamId: huddle.teamId,
        channelId: huddle.channelId,
        messageTs: huddle.messageTs,
        dateStart: huddle.dateStart,
        dateEnd: huddle.dateEnd,
        startedBy: huddle.startedBy,
        participantIdsJson: JSON.stringify(huddle.participantIds),
        // Pending until a fill completes, so the sweep picks it up when the
        // fill after the webhook's answer never finishes.
        nextFillAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({
        target: [
          schema.slackHuddles.teamId,
          schema.slackHuddles.channelId,
          schema.slackHuddles.messageTs,
        ],
      });
    const [current] = await tx
      .select()
      .from(schema.slackHuddles)
      .where(key)
      .for("update")
      .limit(1);
    if (!current) throw new Error("slack huddle row vanished during upsert");
    const merged = mergeSlackHuddles(rowToHuddle(current), huddle);
    await tx
      .update(schema.slackHuddles)
      .set({
        dateStart: merged.dateStart,
        dateEnd: merged.dateEnd,
        startedBy: merged.startedBy,
        participantIdsJson: JSON.stringify(merged.participantIds),
        nextFillAt: nowIso,
        fillAttempts: 0,
        updatedAt: nowIso,
      })
      .where(eq(schema.slackHuddles.id, current.id));
    return merged;
  });
}

async function connectionsForSlackUsers(
  db: HuddleDb,
  teamId: string,
  slackUserIds: string[],
): Promise<SlackUserConnection[]> {
  if (!slackUserIds.length) return [];
  // guard:allow-unscoped — a signed Slack event names the team and users; only
  // connections those Slack users made themselves are read.
  return db
    .select(connectionColumns)
    .from(schema.slackUserConnections)
    .where(
      and(
        eq(schema.slackUserConnections.teamId, teamId),
        inArray(schema.slackUserConnections.slackUserId, slackUserIds),
        eq(schema.slackUserConnections.status, "connected"),
      ),
    );
}

async function connectionsForOwner(
  db: HuddleDb,
  ownerEmail: string,
): Promise<SlackUserConnection[]> {
  return db
    .select(connectionColumns)
    .from(schema.slackUserConnections)
    .where(
      and(
        sql`lower(${schema.slackUserConnections.ownerEmail}) = ${ownerEmail.trim().toLowerCase()}`,
        eq(schema.slackUserConnections.status, "connected"),
      ),
    );
}

/** Adhoc Slack meetings of this owner that could have recorded the huddle. */
async function candidateMeetings(
  db: HuddleDb,
  ownerEmail: string,
  huddle: SlackHuddle,
): Promise<HuddleMeeting[]> {
  // ISO strings compare in time order; the margins absorb format differences
  // (with or without milliseconds) and pickHuddleForMeeting decides exactly.
  const fromIso = new Date(
    huddle.dateStart * 1000 - HUDDLE_START_MATCH_WINDOW_MS - 60_000,
  ).toISOString();
  const lastStartMs =
    huddle.dateEnd !== null
      ? huddle.dateEnd * 1000
      : huddle.dateStart * 1000 + HUDDLE_LATE_JOIN_MAX_MS;
  const toIso = new Date(
    lastStartMs + HUDDLE_START_MATCH_WINDOW_MS + 60_000,
  ).toISOString();
  const rows = await db
    .select({
      id: schema.meetings.id,
      ownerEmail: schema.meetings.ownerEmail,
      actualStart: schema.meetings.actualStart,
    })
    .from(schema.meetings)
    .where(
      and(
        sql`lower(${schema.meetings.ownerEmail}) = ${ownerEmail.trim().toLowerCase()}`,
        eq(schema.meetings.source, "adhoc"),
        eq(schema.meetings.platform, "slack"),
        isNull(schema.meetings.trashedAt),
        gte(schema.meetings.actualStart, fromIso),
        lte(schema.meetings.actualStart, toIso),
      ),
    );
  return rows.filter((row): row is HuddleMeeting => !!row.actualStart);
}

async function candidateHuddles(
  db: HuddleDb,
  teamId: string,
  meetingStartIso: string,
): Promise<SlackHuddle[]> {
  const startMs = Date.parse(meetingStartIso);
  if (!Number.isFinite(startMs)) return [];
  const rows = await db
    .select()
    .from(schema.slackHuddles)
    .where(
      and(
        eq(schema.slackHuddles.teamId, teamId),
        gte(
          schema.slackHuddles.dateStart,
          Math.floor((startMs - HUDDLE_LATE_JOIN_MAX_MS) / 1000),
        ),
        lte(
          schema.slackHuddles.dateStart,
          Math.ceil((startMs + HUDDLE_START_MATCH_WINDOW_MS) / 1000),
        ),
      ),
    );
  return rows.map(rowToHuddle);
}

/** Same meeting and e-mail, same row id: a second insert is a no-op. */
export function huddleParticipantId(meetingId: string, email: string): string {
  const digest = createHash("sha256")
    .update(`${meetingId}|${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
  return `slk_${digest}`;
}

/**
 * Add the huddle's people to the meeting. People the meeting already lists
 * (by e-mail, from any source) are left alone; running it twice adds nothing.
 * Returns the number of rows added.
 */
export async function insertHuddleParticipants(
  db: HuddleDb,
  options: {
    meetingId: string;
    huddle: Pick<SlackHuddle, "dateStart" | "startedBy">;
    people: readonly SlackPerson[];
    nowIso?: string;
  },
): Promise<number> {
  const existing = await db
    .select({ email: schema.meetingParticipants.email })
    .from(schema.meetingParticipants)
    .where(eq(schema.meetingParticipants.meetingId, options.meetingId));
  const rows = buildHuddleParticipantRows({
    meetingId: options.meetingId,
    huddle: options.huddle,
    people: options.people,
    existingEmails: existing.map((row) => row.email),
  });
  if (!rows.length) return 0;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const inserted = await db
    .insert(schema.meetingParticipants)
    .values(
      rows.map((row) => ({
        id: huddleParticipantId(row.meetingId, row.email),
        ...row,
        createdAt: nowIso,
      })),
    )
    .onConflictDoNothing({ target: schema.meetingParticipants.id })
    .returning({ id: schema.meetingParticipants.id });
  return inserted.length;
}

async function markConnectionFailed(
  db: HuddleDb,
  connection: SlackUserConnection,
  error: string,
): Promise<void> {
  await db
    .update(schema.slackUserConnections)
    .set({
      status: "error",
      lastError: error,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.slackUserConnections.id, connection.id));
}

/** Run fn over items, at most `limit` at a time; every outcome is kept. */
async function settleWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

type ResolvedPeople = {
  people: SlackPerson[];
  /** Huddle members Slack could not describe right now; a later fill retries them. */
  pending: number;
};

/**
 * Everyone in the huddle Slack describes, plus how many lookups failed for
 * now (rate limit, outage, timeout). Null when the connection's token is
 * gone, unreadable or rejected: the connection is then marked failed so the
 * person reconnects. A failed lookup never drops the people that did resolve.
 */
async function resolvePeople(
  deps: HuddleDeps,
  connection: SlackUserConnection,
  huddle: SlackHuddle,
): Promise<ResolvedPeople | null> {
  let token: string | null;
  try {
    token = await deps.readToken(connection);
  } catch (error) {
    if (error instanceof SlackTokenError) {
      await markConnectionFailed(deps.db, connection, error.slackError);
      return null;
    }
    throw error;
  }
  if (!token) {
    await markConnectionFailed(deps.db, connection, "token_missing");
    return null;
  }
  const results = await settleWithLimit(
    huddle.participantIds,
    PROFILE_LOOKUP_CONCURRENCY,
    (slackUserId) =>
      fetchSlackPerson({
        token,
        teamId: huddle.teamId,
        slackUserId,
        fetchImpl: deps.fetchImpl,
      }),
  );
  const people: SlackPerson[] = [];
  let pending = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value) people.push(result.value);
    } else if (result.reason instanceof SlackTokenError) {
      await markConnectionFailed(deps.db, connection, result.reason.slackError);
      return null;
    } else {
      pending++;
      console.warn(
        "[clips-slack] Huddle participant lookup failed, retried later:",
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  }
  return { people, pending };
}

/** First retry after this long, doubling per attempt up to the cap. */
export const HUDDLE_FILL_RETRY_BASE_MS = 5 * 60 * 1000;
const HUDDLE_FILL_RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
/** About a day of retries (5 min doubling to 6 h); then the fill is given up. */
export const HUDDLE_FILL_MAX_ATTEMPTS = 10;

function huddleKey(huddle: SlackHuddle) {
  return and(
    eq(schema.slackHuddles.teamId, huddle.teamId),
    eq(schema.slackHuddles.channelId, huddle.channelId),
    eq(schema.slackHuddles.messageTs, huddle.messageTs),
  );
}

/**
 * A fill of this huddle left people or shares pending: keep it due for the
 * sweep, with exponential backoff, until it completes or runs out of
 * attempts.
 */
async function scheduleHuddleFillRetry(
  db: HuddleDb,
  huddle: SlackHuddle,
  nowMs = Date.now(),
): Promise<void> {
  const [row] = await db
    .select({ fillAttempts: schema.slackHuddles.fillAttempts })
    .from(schema.slackHuddles)
    .where(huddleKey(huddle))
    .limit(1);
  if (!row) return;
  const attempts = row.fillAttempts + 1;
  const giveUp = attempts >= HUDDLE_FILL_MAX_ATTEMPTS;
  if (giveUp) {
    console.warn(
      `[clips-slack] Giving up on huddle ${huddle.teamId}/${huddle.channelId}/${huddle.messageTs} after ${attempts} fill attempts.`,
    );
  }
  const delayMs = Math.min(
    HUDDLE_FILL_RETRY_BASE_MS * 2 ** (attempts - 1),
    HUDDLE_FILL_RETRY_MAX_DELAY_MS,
  );
  await db
    .update(schema.slackHuddles)
    .set({
      fillAttempts: attempts,
      nextFillAt: giveUp ? null : new Date(nowMs + delayMs).toISOString(),
    })
    .where(huddleKey(huddle));
}

/** Huddles this recent are filled again when their participant reconnects. */
export const HUDDLE_REARM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A Slack user (re)connected: make their recent huddles due again, with a
 * fresh retry budget, so meetings a failed or missing token left incomplete
 * get filled now.
 */
export async function rearmSlackHuddlesForUser(
  db: HuddleDb,
  teamId: string,
  slackUserId: string,
  nowMs = Date.now(),
): Promise<void> {
  if (!/^[UW][A-Z0-9]+$/.test(slackUserId)) return;
  const nowIso = new Date(nowMs).toISOString();
  await db
    .update(schema.slackHuddles)
    .set({ nextFillAt: nowIso, fillAttempts: 0 })
    .where(
      and(
        eq(schema.slackHuddles.teamId, teamId),
        gte(
          schema.slackHuddles.dateStart,
          Math.floor((nowMs - HUDDLE_REARM_WINDOW_MS) / 1000),
        ),
        sql`${schema.slackHuddles.participantIdsJson} like ${`%"${slackUserId}"%`}`,
      ),
    );
}

/**
 * Every fill of this huddle completed. Only clears what was pending when the
 * fill started: a newer event for the huddle keeps it due.
 */
async function markHuddleFilled(
  db: HuddleDb,
  huddle: SlackHuddle,
  startedIso: string,
): Promise<void> {
  await db
    .update(schema.slackHuddles)
    .set({ nextFillAt: null, fillAttempts: 0 })
    .where(
      and(huddleKey(huddle), lte(schema.slackHuddles.updatedAt, startedIso)),
    );
}

type MeetingFill = {
  /** The huddle the meeting was filled from. */
  huddle: SlackHuddle;
  added: number;
  emails: string[];
  pending: number;
  /**
   * Not everyone could be resolved: lookups Slack could not answer, or the
   * connection's token was missing, unreadable or rejected. The huddle stays
   * due for the sweep.
   */
  incomplete: boolean;
};

/** A fill failed after its huddle was picked; says which huddle to retry. */
class HuddleFillError extends Error {
  constructor(
    readonly huddle: SlackHuddle,
    readonly original: unknown,
  ) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "HuddleFillError";
  }
}

/**
 * Fill a meeting from the best stored huddle of one of its owner's
 * connections. Never schedules retries itself: callers do that once per
 * huddle pass, so one pass costs one attempt.
 */
async function fillMeeting(
  deps: HuddleDeps,
  meeting: HuddleMeeting,
  connections?: SlackUserConnection[],
): Promise<MeetingFill | null> {
  const owned =
    connections ?? (await connectionsForOwner(deps.db, meeting.ownerEmail));
  let unresolved: SlackHuddle | null = null;
  for (const connection of owned) {
    const huddles = await candidateHuddles(
      deps.db,
      connection.teamId,
      meeting.actualStart,
    );
    const huddle = pickHuddleForMeeting(
      huddles,
      meeting,
      connection.slackUserId,
    );
    if (!huddle) continue;
    try {
      const resolved = await resolvePeople(deps, connection, huddle);
      if (!resolved) {
        // The token failed; another connection may still resolve it.
        unresolved ??= huddle;
        continue;
      }
      const added = await insertHuddleParticipants(deps.db, {
        meetingId: meeting.id,
        huddle,
        people: resolved.people,
      });
      const emails = [
        ...new Set(
          resolved.people
            .map((person) => person.email?.trim().toLowerCase())
            .filter((email): email is string => !!email),
        ),
      ];
      return {
        huddle,
        added,
        emails,
        pending: resolved.pending,
        incomplete: resolved.pending > 0,
      };
    } catch (error) {
      throw new HuddleFillError(huddle, error);
    }
  }
  return unresolved
    ? { huddle: unresolved, added: 0, emails: [], pending: 0, incomplete: true }
    : null;
}

function sameHuddle(a: SlackHuddle, b: SlackHuddle): boolean {
  return (
    a.teamId === b.teamId &&
    a.channelId === b.channelId &&
    a.messageTs === b.messageTs
  );
}

/**
 * Fill one meeting from the best stored huddle its owner was in. Returns the
 * number of participants added (0 when no huddle fits or all are there).
 * When not everyone could be resolved, that huddle is left due for the sweep.
 */
export async function fillMeetingFromStoredHuddles(
  deps: HuddleDeps,
  meeting: HuddleMeeting,
  connections?: SlackUserConnection[],
): Promise<number> {
  let fill: MeetingFill | null;
  try {
    fill = await fillMeeting(deps, meeting, connections);
  } catch (error) {
    if (error instanceof HuddleFillError) {
      await scheduleHuddleFillRetry(deps.db, error.huddle).catch(() => {});
      throw error.original;
    }
    throw error;
  }
  if (fill?.incomplete) await scheduleHuddleFillRetry(deps.db, fill.huddle);
  return fill?.added ?? 0;
}

export type HuddleFillResult = { filled: number; pending: number };

/**
 * Store the huddle of a Slack message event. Cheap (one transaction, no
 * Slack calls), so the webhook does it before acknowledging. Null for
 * non-huddle messages and huddles without a connected participant, which
 * are not stored.
 */
export async function storeSlackHuddleEvent(
  deps: HuddleDeps,
  payload: unknown,
): Promise<SlackHuddle | null> {
  const parsed = parseSlackHuddleEvent(payload);
  if (!parsed) return null;
  const connections = await connectionsForSlackUsers(
    deps.db,
    parsed.teamId,
    parsed.participantIds,
  );
  if (!connections.length) return null;
  return upsertSlackHuddle(deps.db, parsed);
}

/**
 * Fill every Slack meeting a connected participant of this stored huddle
 * could have recorded it in, and share stopped public meetings with the
 * huddle's people. One pass is one attempt: every huddle left incomplete
 * (people Slack could not describe, a failed token, an error, a failed share)
 * gets one retry scheduled; otherwise this huddle is marked filled.
 */
export async function fillMeetingsForHuddle(
  deps: HuddleDeps,
  huddle: SlackHuddle,
): Promise<HuddleFillResult> {
  const startedIso = new Date().toISOString();
  const incomplete: SlackHuddle[] = [];
  const markIncomplete = (h: SlackHuddle) => {
    if (!incomplete.some((other) => sameHuddle(other, h))) incomplete.push(h);
  };
  let filled = 0;
  let pending = 0;
  let failure: unknown = null;
  try {
    const connections = await connectionsForSlackUsers(
      deps.db,
      huddle.teamId,
      huddle.participantIds,
    );
    // Stored for a connected participant, but none is connected now (token
    // failed, disconnected): keep it due; reconnecting fills it.
    if (!connections.length) markIncomplete(huddle);
    for (const connection of connections) {
      const meetings = await candidateMeetings(
        deps.db,
        connection.ownerEmail,
        huddle,
      );
      for (const meeting of meetings) {
        const fill = await fillMeeting(deps, meeting, [connection]);
        if (!fill) continue;
        filled += fill.added;
        pending += fill.pending;
        if (fill.incomplete) markIncomplete(fill.huddle);
        if (fill.emails.length && deps.onHuddleParticipants) {
          try {
            await deps.onHuddleParticipants(meeting.id, fill.emails);
          } catch (error) {
            markIncomplete(huddle);
            throw error;
          }
        }
      }
    }
  } catch (error) {
    failure = error instanceof HuddleFillError ? error.original : error;
    markIncomplete(error instanceof HuddleFillError ? error.huddle : huddle);
  }
  for (const due of incomplete) {
    await scheduleHuddleFillRetry(deps.db, due).catch((err) =>
      console.warn("[clips-slack] Could not schedule a huddle retry:", err),
    );
  }
  if (failure) throw failure;
  if (!incomplete.some((due) => sameHuddle(due, huddle))) {
    await markHuddleFilled(deps.db, huddle, startedIso);
  }
  return { filled, pending };
}

/**
 * A Slack message event, stored and filled in one go. The webhook splits the
 * two (store, acknowledge, fill after the response); this is both in order.
 */
export async function handleSlackHuddleEvent(
  deps: HuddleDeps,
  payload: unknown,
): Promise<{ huddle: boolean; filled: number; pending: number }> {
  if (!parseSlackHuddleEvent(payload)) {
    return { huddle: false, filled: 0, pending: 0 };
  }
  const huddle = await storeSlackHuddleEvent(deps, payload);
  if (!huddle) return { huddle: true, filled: 0, pending: 0 };
  return { huddle: true, ...(await fillMeetingsForHuddle(deps, huddle)) };
}

/**
 * The durable retry: fill again every huddle whose fill is due. A huddle is
 * due from the moment it is stored until a fill completes, and after a fill
 * that left people or shares pending (with backoff, see
 * scheduleHuddleFillRetry). Each huddle is independent; one failing does not
 * stop the others.
 */
export async function sweepDueSlackHuddles(
  deps: HuddleDeps,
  nowMs = Date.now(),
): Promise<HuddleFillResult & { huddles: number; failed: number }> {
  const rows = await deps.db
    .select()
    .from(schema.slackHuddles)
    .where(
      and(
        isNotNull(schema.slackHuddles.nextFillAt),
        lte(schema.slackHuddles.nextFillAt, new Date(nowMs).toISOString()),
      ),
    );
  const total = { huddles: rows.length, failed: 0, filled: 0, pending: 0 };
  for (const row of rows) {
    try {
      const result = await fillMeetingsForHuddle(deps, rowToHuddle(row));
      total.filled += result.filled;
      total.pending += result.pending;
    } catch (err) {
      total.failed++;
      console.warn(
        "[clips-slack] Huddle sweep failed for one huddle:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return total;
}

/**
 * After a meeting stops: when it is an adhoc Slack meeting, fill it from the
 * huddles already stored. Anything else is left alone.
 */
export async function fillSlackHuddleParticipantsForMeeting(
  deps: HuddleDeps,
  meetingId: string,
): Promise<number> {
  const [meeting] = await deps.db
    .select({
      id: schema.meetings.id,
      ownerEmail: schema.meetings.ownerEmail,
      actualStart: schema.meetings.actualStart,
      source: schema.meetings.source,
      platform: schema.meetings.platform,
    })
    .from(schema.meetings)
    .where(eq(schema.meetings.id, meetingId))
    .limit(1);
  if (
    !meeting ||
    meeting.source !== "adhoc" ||
    meeting.platform !== "slack" ||
    !meeting.actualStart ||
    !meeting.ownerEmail
  ) {
    return 0;
  }
  return fillMeetingFromStoredHuddles(deps, {
    id: meeting.id,
    ownerEmail: meeting.ownerEmail,
    actualStart: meeting.actualStart,
  });
}
