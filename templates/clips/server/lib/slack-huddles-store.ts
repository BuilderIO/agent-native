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

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
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
  /** The connection's decrypted Slack user token, or null when it is gone. */
  readToken: (connection: SlackUserConnection) => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

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

async function resolvePeople(
  deps: HuddleDeps,
  connection: SlackUserConnection,
  huddle: SlackHuddle,
): Promise<SlackPerson[] | null> {
  const token = await deps.readToken(connection);
  if (!token) {
    await markConnectionFailed(deps.db, connection, "token_missing");
    return null;
  }
  const people: SlackPerson[] = [];
  for (const slackUserId of huddle.participantIds) {
    try {
      const person = await fetchSlackPerson({
        token,
        teamId: huddle.teamId,
        slackUserId,
        fetchImpl: deps.fetchImpl,
      });
      if (person) people.push(person);
    } catch (error) {
      if (error instanceof SlackTokenError) {
        await markConnectionFailed(deps.db, connection, error.slackError);
        return null;
      }
      throw error;
    }
  }
  return people;
}

/**
 * Fill one meeting from the best stored huddle its owner was in. Returns the
 * number of participants added (0 when no huddle fits or all are there).
 */
export async function fillMeetingFromStoredHuddles(
  deps: HuddleDeps,
  meeting: HuddleMeeting,
  connections?: SlackUserConnection[],
): Promise<number> {
  const owned = connections ?? (await connectionsForOwner(deps.db, meeting.ownerEmail));
  for (const connection of owned) {
    const huddles = await candidateHuddles(
      deps.db,
      connection.teamId,
      meeting.actualStart,
    );
    const huddle = pickHuddleForMeeting(huddles, meeting, connection.slackUserId);
    if (!huddle) continue;
    const people = await resolvePeople(deps, connection, huddle);
    if (!people) continue;
    return insertHuddleParticipants(deps.db, {
      meetingId: meeting.id,
      huddle,
      people,
    });
  }
  return 0;
}

/**
 * A Slack message event. Non-huddle messages and huddles without a connected
 * participant are ignored and nothing is stored.
 */
export async function handleSlackHuddleEvent(
  deps: HuddleDeps,
  payload: unknown,
): Promise<{ huddle: boolean; filled: number }> {
  const parsed = parseSlackHuddleEvent(payload);
  if (!parsed) return { huddle: false, filled: 0 };
  const connections = await connectionsForSlackUsers(
    deps.db,
    parsed.teamId,
    parsed.participantIds,
  );
  if (!connections.length) return { huddle: true, filled: 0 };

  const huddle = await upsertSlackHuddle(deps.db, parsed);
  let filled = 0;
  for (const connection of connections) {
    const meetings = await candidateMeetings(deps.db, connection.ownerEmail, huddle);
    for (const meeting of meetings) {
      filled += await fillMeetingFromStoredHuddles(deps, meeting, [connection]);
    }
  }
  return { huddle: true, filled };
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
