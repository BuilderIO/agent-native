/**
 * Monthly recap metrics — what an owner's clips did over one calendar month.
 *
 * Human and agent audiences are counted from separate tables on purpose
 * (`recording_views` vs `recording_agent_views`), matching the split described
 * in `agent-views.ts`: no human-view query can ever pick agents up.
 *
 * Months are closed on UTC boundaries. Per-user timezones are not yet stored,
 * so a recap covers the same wall-clock window for everyone.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

export interface RecapMonthRange {
  month: string;
  startAt: string;
  endAt: string;
}

export interface RecapAgentBreakdownEntry {
  /** Null when the reader could not be identified. */
  agentLabel: string | null;
  sessions: number;
}

export interface RecapTopClip {
  recordingId: string;
  title: string;
  thumbnailUrl: string | null;
  durationMs: number;
  recordedAt: string;
  humanViews: number;
  agentSessions: number;
  /** Mean completion across the humans who watched it this month, 0-100. */
  completedPct: number;
  /** Video-time position where watching last stopped, or null if unreported. */
  dropOffMs: number | null;
  agentBreakdown: RecapAgentBreakdownEntry[];
}

export interface MonthlyRecap {
  month: string;
  humanViews: number;
  agentSessions: number;
  topClip: RecapTopClip;
}

/** `2026-07` -> the half-open UTC range `[2026-07-01, 2026-08-01)`. */
export function recapMonthRange(month: string): RecapMonthRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error(`Invalid recap month: ${month}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    month,
    startAt: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    endAt: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
  };
}

/** The calendar month immediately before the one containing `now`, in UTC. */
export function previousRecapMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const previous = new Date(Date.UTC(year, monthIndex - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function recapMonthLabel(month: string): string {
  const { startAt } = recapMonthRange(month);
  return new Date(startAt).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * Trashed, archived, and unfinished clips are excluded so the top clip is
 * always one the recap can link to — the ranking is recomputed at send time,
 * and a clip the owner deleted must not headline it.
 */
async function ownerRecordingIds(ownerEmail: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(
      and(
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        eq(schema.recordings.status, "ready"),
        isNull(schema.recordings.archivedAt),
        isNull(schema.recordings.trashedAt),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Counts view rows, not distinct people. Deduping an identity across a month
 * was both ambiguous — `viewerKey` is nullable on rows predating it — and
 * expensive, so the recap reports human views and leaves unique audience out
 * of scope. Summing these per-recording counts is therefore correct: one
 * person watching two clips is genuinely two views.
 */
async function humanViewCounts(
  recordingIds: string[],
  range: RecapMonthRange,
): Promise<Map<string, number>> {
  if (recordingIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      recordingId: schema.recordingViews.recordingId,
      views: sql<number>`count(*)`,
    })
    .from(schema.recordingViews)
    .where(
      and(
        inArray(schema.recordingViews.recordingId, recordingIds),
        gte(schema.recordingViews.viewedAt, range.startAt),
        lt(schema.recordingViews.viewedAt, range.endAt),
      ),
    )
    .groupBy(schema.recordingViews.recordingId);
  return new Map(rows.map((row) => [row.recordingId, Number(row.views)]));
}

async function agentSessionCounts(
  recordingIds: string[],
  range: RecapMonthRange,
): Promise<Map<string, number>> {
  if (recordingIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      recordingId: schema.recordingAgentViews.recordingId,
      sessions: sql<number>`count(*)`,
    })
    .from(schema.recordingAgentViews)
    .where(
      and(
        inArray(schema.recordingAgentViews.recordingId, recordingIds),
        gte(schema.recordingAgentViews.firstSeenAt, range.startAt),
        lt(schema.recordingAgentViews.firstSeenAt, range.endAt),
      ),
    )
    .groupBy(schema.recordingAgentViews.recordingId);
  return new Map(rows.map((row) => [row.recordingId, Number(row.sessions)]));
}

async function agentBreakdown(
  recordingId: string,
  range: RecapMonthRange,
): Promise<RecapAgentBreakdownEntry[]> {
  const rows = await getDb()
    .select({
      agentLabel: schema.recordingAgentViews.agentLabel,
      sessions: sql<number>`count(*)`,
    })
    .from(schema.recordingAgentViews)
    .where(
      and(
        eq(schema.recordingAgentViews.recordingId, recordingId),
        gte(schema.recordingAgentViews.firstSeenAt, range.startAt),
        lt(schema.recordingAgentViews.firstSeenAt, range.endAt),
      ),
    )
    .groupBy(schema.recordingAgentViews.agentLabel)
    .orderBy(desc(sql`count(*)`), asc(schema.recordingAgentViews.agentLabel));
  return rows.map((row) => ({
    agentLabel: row.agentLabel || null,
    sessions: Number(row.sessions),
  }));
}

/**
 * Mean completion across viewers who watched this month, and the video-time
 * position where watching last stopped.
 *
 * `recording_viewers` holds no per-month completion, so this reflects each
 * viewer's lifetime progress on a clip they watched during the month. A viewer
 * who finished it in June and reopened it in July reports June's completion.
 */
async function watchDepth(
  recordingId: string,
  range: RecapMonthRange,
): Promise<{ completedPct: number; dropOffMs: number | null }> {
  const db = getDb();
  const monthViewerIds = await db
    .selectDistinct({ viewerId: schema.recordingViews.viewerId })
    .from(schema.recordingViews)
    .where(
      and(
        eq(schema.recordingViews.recordingId, recordingId),
        gte(schema.recordingViews.viewedAt, range.startAt),
        lt(schema.recordingViews.viewedAt, range.endAt),
      ),
    );
  const viewerIds = monthViewerIds.map((row) => row.viewerId);
  if (viewerIds.length === 0) return { completedPct: 0, dropOffMs: null };

  const [completion] = await db
    .select({ mean: sql<number>`avg(${schema.recordingViewers.completedPct})` })
    .from(schema.recordingViewers)
    .where(
      and(
        eq(schema.recordingViewers.recordingId, recordingId),
        inArray(schema.recordingViewers.id, viewerIds),
      ),
    );

  const [lastProgress] = await db
    .select({ timestampMs: schema.recordingEvents.timestampMs })
    .from(schema.recordingEvents)
    .where(
      and(
        eq(schema.recordingEvents.recordingId, recordingId),
        inArray(schema.recordingEvents.viewerId, viewerIds),
        inArray(schema.recordingEvents.kind, ["watch-progress", "pause"]),
        gte(schema.recordingEvents.createdAt, range.startAt),
        lt(schema.recordingEvents.createdAt, range.endAt),
      ),
    )
    .orderBy(desc(schema.recordingEvents.timestampMs))
    .limit(1);

  return {
    completedPct: Math.round(Number(completion?.mean ?? 0)),
    dropOffMs: lastProgress ? Number(lastProgress.timestampMs) : null,
  };
}

/**
 * Rank by total audience (human views + agent sessions), breaking
 * ties on the more recently recorded clip.
 */
export function rankTopClip<
  T extends { recordingId: string; audience: number; recordedAt: string },
>(candidates: readonly T[]): T | null {
  return (
    [...candidates].sort(
      (left, right) =>
        right.audience - left.audience ||
        right.recordedAt.localeCompare(left.recordedAt) ||
        left.recordingId.localeCompare(right.recordingId),
    )[0] ?? null
  );
}

/**
 * Returns null when the owner had no human or agent audience that month, which
 * is also the signal not to send them a recap at all.
 */
export async function computeMonthlyRecap(
  ownerEmail: string,
  month: string,
): Promise<MonthlyRecap | null> {
  const range = recapMonthRange(month);
  const recordingIds = await ownerRecordingIds(ownerEmail);
  if (recordingIds.length === 0) return null;

  const [humansByRecording, agentsByRecording] = await Promise.all([
    humanViewCounts(recordingIds, range),
    agentSessionCounts(recordingIds, range),
  ]);

  const humanViews = [...humansByRecording.values()].reduce(
    (total, value) => total + value,
    0,
  );
  const agentSessions = [...agentsByRecording.values()].reduce(
    (total, value) => total + value,
    0,
  );
  if (humanViews === 0 && agentSessions === 0) return null;

  const watchedIds = [
    ...new Set([...humansByRecording.keys(), ...agentsByRecording.keys()]),
  ];
  const watched = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      thumbnailUrl: schema.recordings.thumbnailUrl,
      durationMs: schema.recordings.durationMs,
      createdAt: schema.recordings.createdAt,
    })
    .from(schema.recordings)
    .where(
      and(
        inArray(schema.recordings.id, watchedIds),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  const ranked = rankTopClip(
    watched.map((recording) => ({
      recordingId: recording.id,
      audience:
        (humansByRecording.get(recording.id) ?? 0) +
        (agentsByRecording.get(recording.id) ?? 0),
      recordedAt: recording.createdAt,
      recording,
    })),
  );
  if (!ranked) return null;

  const [depth, breakdown] = await Promise.all([
    watchDepth(ranked.recordingId, range),
    agentBreakdown(ranked.recordingId, range),
  ]);

  return {
    month,
    humanViews,
    agentSessions,
    topClip: {
      recordingId: ranked.recordingId,
      title: ranked.recording.title,
      thumbnailUrl: ranked.recording.thumbnailUrl,
      durationMs: ranked.recording.durationMs,
      recordedAt: ranked.recording.createdAt,
      humanViews: humansByRecording.get(ranked.recordingId) ?? 0,
      agentSessions: agentsByRecording.get(ranked.recordingId) ?? 0,
      completedPct: depth.completedPct,
      dropOffMs: depth.dropOffMs,
      agentBreakdown: breakdown,
    },
  };
}

/** Owners with any human or agent audience in the month, for reconciliation. */
export async function listOwnersWithMonthlyAudience(
  month: string,
): Promise<string[]> {
  const range = recapMonthRange(month);
  const db = getDb();
  const [humanOwners, agentOwners] = await Promise.all([
    db
      .selectDistinct({ ownerEmail: schema.recordings.ownerEmail })
      .from(schema.recordingViews)
      .innerJoin(
        schema.recordings,
        eq(schema.recordings.id, schema.recordingViews.recordingId),
      )
      .where(
        and(
          gte(schema.recordingViews.viewedAt, range.startAt),
          lt(schema.recordingViews.viewedAt, range.endAt),
        ),
      ),
    db
      .selectDistinct({ ownerEmail: schema.recordings.ownerEmail })
      .from(schema.recordingAgentViews)
      .innerJoin(
        schema.recordings,
        eq(schema.recordings.id, schema.recordingAgentViews.recordingId),
      )
      .where(
        and(
          gte(schema.recordingAgentViews.firstSeenAt, range.startAt),
          lt(schema.recordingAgentViews.firstSeenAt, range.endAt),
        ),
      ),
  ]);
  return [
    ...new Set(
      [...humanOwners, ...agentOwners]
        .map((row) => row.ownerEmail.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}
