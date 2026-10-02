import { createHash } from "node:crypto";

import {
  agentTroubleCauseForCode,
  isAgentTroubleCause,
  normalizeAgentTroubleMessage,
} from "@agent-native/core/shared/analytics-events";
import {
  type AnyColumn,
  and,
  eq,
  inArray,
  lt,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  EVENT_FRICTION_SCORE_INPUTS,
  EVENT_FRICTION_SIGNALS,
  type EventFrictionSignal,
  type FrictionCounts,
  REPLAY_FRICTION_SCORE_INPUTS,
  REPLAY_FRICTION_SIGNALS,
  type ReplayFrictionSignal,
  SESSION_FRICTION_SIGNAL_CAP,
  SESSION_FRICTION_WEIGHTS,
  type SessionFriction,
  type SessionFrictionSignal,
  type SessionFrictionSort,
  type SessionTroubleGroup,
  sessionFrictionScore,
  topSessionFrictionSignals,
} from "../../shared/session-friction.js";
import { getDb, schema } from "../db/index.js";
import {
  type ErrorReadScope,
  listRecordingErrorIssues,
} from "./error-capture.js";
import {
  boundedText,
  type SessionEventIndexInputRow,
  sessionEventTenantKey,
  sessionIdOf,
} from "./session-event-index.js";
import {
  detectReplayFriction,
  parseReplayFrictionDetectorState,
} from "./session-friction-detector.js";

/**
 * Session friction, measured at ingest into Analytics' own Postgres tables so
 * no view reads the event store.
 *
 * Replay friction is per recording. A recording is measured only when its
 * first chunks arrived after the friction tables existed, and only while the
 * row has processed every chunk the recording stores; any batch it misses
 * leaves the counts short of the recording, so reads report it unmeasured.
 *
 * Event friction is per analytics session and is written inside the session
 * event index savepoint, so the index's gap marker covers a failed write too.
 * A session is measured only if it began after its tenant's friction coverage
 * began, has no earlier sibling recording, and has no gap marker.
 */

const PAGEVIEW_EVENT = "pageview";
const ACTION_RESPONSE_EVENT = "action.response";
const RUN_OUTCOME_EVENT = "agent_run_outcome";
const STUCK_CHAT_EVENT = "agent_chat_stuck_detected";
const FEEDBACK_EVENT = "agent_feedback_submitted";

/** Back to the previous page within this long of leaving it is a quick back. */
export const QUICK_BACK_WINDOW_MS = 5_000;
const MAX_TROUBLE_LABEL_LENGTH = 120;
const MAX_TROUBLE_STATUS_LENGTH = 80;
const MAX_PATH_LENGTH = 2_000;
const TROUBLE_GROUPS_PER_SESSION = 3;
const FRICTION_RETENTION_BUFFER_DAYS = 2;
const WARN_INTERVAL_MS = 60_000;

const lastWarnAt = new Map<string, number>();
let frictionTablesReady = false;

function warnFrictionFailure(message: string, error: unknown): void {
  const now = Date.now();
  if (now - (lastWarnAt.get(message) ?? 0) < WARN_INTERVAL_MS) return;
  lastWarnAt.set(message, now);
  console.warn(`[session-friction] ${message}`, error);
}

function hashedId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

async function frictionCoverageTableExists(db: any): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT to_regclass('analytics_session_friction_coverage') AS table_name`,
  );
  const rows = Array.isArray(result) ? result : result?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Postgres table existence check returned no row array");
  }
  const value = rows[0]?.table_name;
  if (value === null) return false;
  if (typeof value === "string" && value) return true;
  throw new Error("Postgres table existence check returned an invalid value");
}

/**
 * Code deploys before the scheduled migration creates the friction tables.
 * Until the coverage table (created last) exists nothing is measured, and
 * reads say so. Tables are only ever added, so only "ready" is cached.
 */
export async function sessionFrictionReady(db: any): Promise<boolean> {
  frictionTablesReady ||= await frictionCoverageTableExists(db);
  return frictionTablesReady;
}

const REPLAY_COLUMNS = {
  error_then_leave: "errorThenLeave",
  http_5xx: "http5xx",
  retry_loops: "retryLoops",
  error_toasts: "errorToasts",
  dead_clicks: "deadClicks",
  slow_requests: "slowRequests",
  http_4xx: "http4xx",
} as const satisfies Record<
  ReplayFrictionSignal,
  keyof typeof schema.sessionRecordingFriction.$inferSelect
>;

const EVENT_COLUMNS = {
  agent_failures: "agentFailures",
  stuck_chats: "stuckChats",
  thumbs_down: "thumbsDown",
  failed_actions: "failedActions",
  quick_backs: "quickBacks",
  cancelled_runs: "cancelledRuns",
} as const satisfies Record<
  EventFrictionSignal,
  keyof typeof schema.analyticsSessionFriction.$inferSelect
>;

function parseReplayEventsStrict(inlineData: string): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inlineData);
  } catch {
    // coercion-ok: null is "unreadable"; the caller leaves the recording unmeasured.
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  const events = (parsed as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? events : null;
}

export interface ReplayFrictionInput {
  recordingId: string;
  sessionId: string;
  ownerEmail: string;
  orgId: string | null;
  /** Chunks the recording stored before this batch. */
  priorChunkCount: number;
  /** Chunks this batch stored, with the events they arrived with. */
  newChunks: ReadonlyArray<{ seq: number; inlineData: string | null }>;
  /** The counts this batch wrote to the recording, so the score matches. */
  errorCount: number;
  rageClickCount: number;
  ingestedAt: string;
}

/**
 * Measures one ingested batch. Never fails the upload: a batch it cannot
 * measure leaves the row behind the recording, which reads as unmeasured.
 */
export async function recordReplayFriction(
  input: ReplayFrictionInput,
): Promise<void> {
  if (!input.newChunks.length) return;
  try {
    const db = getDb() as any;
    if (!(await sessionFrictionReady(db))) return;
    const t = schema.sessionRecordingFriction;
    let existing: typeof t.$inferSelect | undefined;
    if (input.priorChunkCount > 0) {
      [existing] = await db
        .select()
        .from(t)
        .where(eq(t.recordingId, input.recordingId))
        .limit(1);
      if (!existing || existing.processedChunks !== input.priorChunkCount) {
        return;
      }
    }
    const previousState = existing
      ? parseReplayFrictionDetectorState(existing.detectorState)
      : null;
    if (existing && !previousState) return;

    const events: unknown[] = [];
    for (const chunk of [...input.newChunks].sort((a, b) => a.seq - b.seq)) {
      const parsed = chunk.inlineData
        ? parseReplayEventsStrict(chunk.inlineData)
        : null;
      if (!parsed) return;
      events.push(...parsed);
    }
    const { state, delta, errorThenLeave } = detectReplayFriction(
      events,
      previousState,
    );
    const counts = {
      deadClicks: (existing?.deadClicks ?? 0) + delta.deadClicks,
      errorToasts: (existing?.errorToasts ?? 0) + delta.errorToasts,
      retryLoops: (existing?.retryLoops ?? 0) + delta.retryLoops,
      errorThenLeave: errorThenLeave ? 1 : 0,
      slowRequests: (existing?.slowRequests ?? 0) + delta.slowRequests,
      http4xx: (existing?.http4xx ?? 0) + delta.http4xx,
      http5xx: (existing?.http5xx ?? 0) + delta.http5xx,
    };
    const score = sessionFrictionScore(
      {
        ...replayCountsBySignal(counts),
        errors: input.errorCount,
        rage_clicks: input.rageClickCount,
      },
      REPLAY_FRICTION_SCORE_INPUTS,
    );
    const values = {
      ...counts,
      processedChunks: input.priorChunkCount + input.newChunks.length,
      score,
      detectorState: JSON.stringify(state),
      updatedAt: input.ingestedAt,
    };
    if (existing) {
      // Conditional on the count read above, so two overlapping uploads can
      // never both advance the same row.
      await db
        .update(t)
        .set(values)
        .where(
          and(
            eq(t.recordingId, input.recordingId),
            eq(t.processedChunks, input.priorChunkCount),
          ),
        );
      return;
    }
    await db
      .insert(t)
      .values({
        recordingId: input.recordingId,
        tenantKey: sessionEventTenantKey(input.ownerEmail, input.orgId),
        ownerEmail: input.ownerEmail,
        orgId: input.orgId,
        sessionId: input.sessionId,
        ...values,
      })
      .onConflictDoNothing();
  } catch (error) {
    warnFrictionFailure(
      "Replay friction write failed; the recording reads as unmeasured:",
      error,
    );
  }
}

function replayCountsBySignal(
  row: Record<(typeof REPLAY_COLUMNS)[ReplayFrictionSignal], number>,
): Record<ReplayFrictionSignal, number> {
  return Object.fromEntries(
    REPLAY_FRICTION_SIGNALS.map((signal) => [
      signal,
      Number(row[REPLAY_COLUMNS[signal]] ?? 0),
    ]),
  ) as Record<ReplayFrictionSignal, number>;
}

function eventCountsBySignal(
  row: Record<(typeof EVENT_COLUMNS)[EventFrictionSignal], number | null>,
): Record<EventFrictionSignal, number> {
  return Object.fromEntries(
    EVENT_FRICTION_SIGNALS.map((signal) => [
      signal,
      Number(row[EVENT_COLUMNS[signal]] ?? 0),
    ]),
  ) as Record<EventFrictionSignal, number>;
}

interface NavState {
  v: 1;
  previous: string | null;
  current: string | null;
  at: number | null;
}

function parseNavState(raw: string | null): NavState {
  if (raw === null) return { v: 1, previous: null, current: null, at: null };
  const parsed = JSON.parse(raw) as NavState;
  if (parsed?.v !== 1) {
    throw new Error("Session friction navigation state is unreadable");
  }
  return parsed;
}

type SessionFrictionRow = typeof schema.analyticsSessionFriction.$inferInsert;
type SessionTroubleRow = typeof schema.analyticsSessionTrouble.$inferInsert;

/** Ingest serializes properties itself, so a parse failure is a real error. */
function parseProperties(properties: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(properties);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function stringProperty(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Friction counts and trouble groups for one batch. Every session in the
 * batch gets a row, even with nothing to count: the row is how reads know
 * the index saw the session.
 */
export function aggregateSessionFrictionEvents(
  rows: readonly SessionEventIndexInputRow[],
  navStates: ReadonlyMap<string, string | null>,
): { sessions: SessionFrictionRow[]; troubles: SessionTroubleRow[] } {
  const sessions = new Map<string, SessionFrictionRow & { nav: NavState }>();
  const troubles = new Map<string, SessionTroubleRow>();
  const ordered = rows
    .map((row) => ({ row, sessionId: sessionIdOf(row.sessionId) }))
    .filter((entry) => entry.sessionId && entry.row.ownerEmail)
    .sort((a, b) => a.row.timestamp.localeCompare(b.row.timestamp));

  for (const { row, sessionId } of ordered) {
    const orgId = row.orgId || null;
    const tenantKey = sessionEventTenantKey(row.ownerEmail, orgId);
    const id = hashedId("asf", [tenantKey, sessionId!]);
    let session = sessions.get(id);
    if (!session) {
      session = {
        id,
        tenantKey,
        ownerEmail: row.ownerEmail,
        orgId,
        sessionId: sessionId!,
        failedActions: 0,
        stuckChats: 0,
        thumbsDown: 0,
        cancelledRuns: 0,
        agentFailures: 0,
        quickBacks: 0,
        navState: null,
        firstAt: row.timestamp,
        lastAt: row.timestamp,
        nav: parseNavState(navStates.get(id) ?? null),
      };
      sessions.set(id, session);
    }
    if (row.timestamp < session.firstAt!) session.firstAt = row.timestamp;
    if (row.timestamp > session.lastAt!) session.lastAt = row.timestamp;

    const addTrouble = (
      kind: "action" | "agent",
      label: string,
      status: string | null,
      cause: string | null,
      keyParts: readonly string[],
    ) => {
      const troubleId = hashedId("ast", [
        tenantKey,
        sessionId!,
        kind,
        ...keyParts,
      ]);
      const existing = troubles.get(troubleId);
      if (existing) {
        existing.eventCount = (existing.eventCount ?? 0) + 1;
        existing.lastAt = row.timestamp;
        existing.status = status;
        return;
      }
      troubles.set(troubleId, {
        id: troubleId,
        tenantKey,
        ownerEmail: row.ownerEmail,
        orgId,
        sessionId: sessionId!,
        kind,
        label,
        status,
        cause,
        eventCount: 1,
        firstAt: row.timestamp,
        lastAt: row.timestamp,
      });
    };

    if (row.eventName === STUCK_CHAT_EVENT) {
      session.stuckChats = (session.stuckChats ?? 0) + 1;
      continue;
    }
    if (
      row.eventName !== PAGEVIEW_EVENT &&
      row.eventName !== ACTION_RESPONSE_EVENT &&
      row.eventName !== RUN_OUTCOME_EVENT &&
      row.eventName !== FEEDBACK_EVENT
    ) {
      continue;
    }
    const properties = parseProperties(row.properties);

    if (row.eventName === FEEDBACK_EVENT) {
      if (properties.sentiment === "negative") {
        session.thumbsDown = (session.thumbsDown ?? 0) + 1;
      }
      continue;
    }

    if (row.eventName === ACTION_RESPONSE_EVENT) {
      if (properties.success !== false || properties.outcome === "cancelled") {
        continue;
      }
      session.failedActions = (session.failedActions ?? 0) + 1;
      const action =
        boundedText(
          stringProperty(properties.action),
          MAX_TROUBLE_LABEL_LENGTH,
        ) || "unknown";
      const status =
        boundedText(
          stringProperty(properties.status_code) ??
            stringProperty(properties.outcome),
          MAX_TROUBLE_STATUS_LENGTH,
        ) || "error";
      addTrouble("action", action, status, null, [action, status]);
      continue;
    }

    if (row.eventName === RUN_OUTCOME_EVENT) {
      if (properties.outcome === "stopped") {
        session.cancelledRuns = (session.cancelledRuns ?? 0) + 1;
        continue;
      }
      if (
        properties.outcome !== "failed" &&
        properties.outcome !== "interrupted"
      ) {
        continue;
      }
      session.agentFailures = (session.agentFailures ?? 0) + 1;
      const code =
        boundedText(
          stringProperty(properties.code),
          MAX_TROUBLE_STATUS_LENGTH,
        ) || null;
      // Older recorders send no cause, so the same list names it here.
      const cause = isAgentTroubleCause(properties.cause)
        ? properties.cause
        : agentTroubleCauseForCode(code);
      if (cause) {
        addTrouble("agent", cause, code, cause, ["cause", cause]);
        continue;
      }
      const message =
        normalizeAgentTroubleMessage(
          stringProperty(properties.error_message),
        ) ||
        code ||
        String(properties.outcome);
      addTrouble("agent", message, code, null, ["message", message]);
      continue;
    }

    const path = boundedText(stringProperty(properties.path), MAX_PATH_LENGTH);
    const at = Date.parse(row.timestamp);
    if (!path || !Number.isFinite(at)) continue;
    const page = shortHash(path);
    const nav = session.nav;
    if (page === nav.current || (nav.at !== null && at < nav.at)) continue;
    if (
      page === nav.previous &&
      nav.at !== null &&
      at - nav.at <= QUICK_BACK_WINDOW_MS
    ) {
      session.quickBacks = (session.quickBacks ?? 0) + 1;
    }
    session.nav = { v: 1, previous: nav.current, current: page, at };
    session.navState = JSON.stringify(session.nav);
  }

  return {
    sessions: [...sessions.values()]
      .map(({ nav: _nav, ...session }) => ({
        ...session,
        score: sessionFrictionScore(
          eventCountsBySignal(session as any),
          EVENT_FRICTION_SCORE_INPUTS,
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    troubles: [...troubles.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The event score of a row after the upsert adds this batch's counts. */
function mergedEventScoreSql(): SQL {
  const f = schema.analyticsSessionFriction;
  return sql.join(
    EVENT_FRICTION_SIGNALS.map((signal) => {
      const column = f[EVENT_COLUMNS[signal]];
      return sql`${sql.raw(String(SESSION_FRICTION_WEIGHTS[signal]))} * least(${column} + ${sql.raw(`excluded.${column.name}`)}, ${sql.raw(String(SESSION_FRICTION_SIGNAL_CAP))})`;
    }),
    sql` + `,
  );
}

/**
 * Runs inside the session event index savepoint. Throwing rolls back the
 * index write too, and the index then marks the batch's sessions incomplete.
 */
export async function recordSessionEventFriction(
  savepoint: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  if (!(await sessionFrictionReady(savepoint))) return;
  const f = schema.analyticsSessionFriction;
  const navIds = new Set<string>();
  for (const row of rows) {
    const sessionId = sessionIdOf(row.sessionId);
    if (row.eventName !== PAGEVIEW_EVENT || !sessionId || !row.ownerEmail) {
      continue;
    }
    navIds.add(
      hashedId("asf", [
        sessionEventTenantKey(row.ownerEmail, row.orgId || null),
        sessionId,
      ]),
    );
  }
  const navStates = new Map<string, string | null>();
  if (navIds.size) {
    const existing: Array<{ id: string; navState: string | null }> =
      await savepoint
        .select({ id: f.id, navState: f.navState })
        .from(f)
        .where(inArray(f.id, [...navIds]));
    for (const row of existing) navStates.set(row.id, row.navState);
  }
  const { sessions, troubles } = aggregateSessionFrictionEvents(
    rows,
    navStates,
  );
  if (!sessions.length) return;

  const merged = (column: AnyColumn & { name: string }) =>
    sql`${column} + ${sql.raw(`excluded.${column.name}`)}`;
  await savepoint
    .insert(f)
    .values(sessions)
    .onConflictDoUpdate({
      target: [f.tenantKey, f.sessionId],
      set: {
        failedActions: merged(f.failedActions),
        stuckChats: merged(f.stuckChats),
        thumbsDown: merged(f.thumbsDown),
        cancelledRuns: merged(f.cancelledRuns),
        agentFailures: merged(f.agentFailures),
        quickBacks: merged(f.quickBacks),
        score: mergedEventScoreSql(),
        navState: sql`coalesce(excluded.nav_state, ${f.navState})`,
        firstAt: sql`least(${f.firstAt}, excluded.first_at)`,
        lastAt: sql`greatest(${f.lastAt}, excluded.last_at)`,
      },
    });

  if (troubles.length) {
    const t = schema.analyticsSessionTrouble;
    await savepoint
      .insert(t)
      .values(troubles)
      .onConflictDoUpdate({
        target: t.id,
        set: {
          eventCount: sql`${t.eventCount} + excluded.event_count`,
          status: sql`case when excluded.last_at >= ${t.lastAt} then excluded.status else ${t.status} end`,
          firstAt: sql`least(${t.firstAt}, excluded.first_at)`,
          lastAt: sql`greatest(${t.lastAt}, excluded.last_at)`,
        },
      });
  }

  const tenants = new Map<
    string,
    { ownerEmail: string; orgId: string | null }
  >();
  for (const session of sessions) {
    tenants.set(session.tenantKey, {
      ownerEmail: session.ownerEmail,
      orgId: session.orgId ?? null,
    });
  }
  await savepoint
    .insert(schema.analyticsSessionFrictionCoverage)
    .values(
      [...tenants.entries()].map(([tenantKey, tenant]) => ({
        tenantKey,
        ownerEmail: tenant.ownerEmail,
        orgId: tenant.orgId,
        startedAt: receivedAt,
      })),
    )
    .onConflictDoNothing();
}

const recordingTenantSql = (recording: {
  orgId: AnyColumn;
  ownerEmail: AnyColumn;
}) =>
  sql`(case when ${recording.orgId} is not null then 'org:' || ${recording.orgId} else 'user:' || ${recording.ownerEmail} end)`;

/** True when the recording's session events were measured completely. */
function eventFrictionCoveredSql(): SQL {
  const r = schema.sessionRecordings;
  const sibling = alias(schema.sessionRecordings, "session_friction_sibling");
  const coverage = schema.analyticsSessionFrictionCoverage;
  const gaps = schema.analyticsSessionEventGaps;
  const tenant = recordingTenantSql(r);
  const coverageStart = sql`(select ${coverage.startedAt} from ${coverage} where ${coverage.tenantKey} = ${tenant})`;
  return sql`(${r.startedAt} >= ${coverageStart} and not exists (select 1 from ${r} as ${sibling} where ${sibling.sessionId} = ${r.sessionId} and ${recordingTenantSql(sibling)} = ${tenant} and ${sibling.startedAt} < ${coverageStart}) and not exists (select 1 from ${gaps} where ${gaps.tenantKey} = ${tenant} and ${gaps.sessionId} = ${r.sessionId}))`;
}

function replayValueSql(column: AnyColumn): SQL {
  const r = schema.sessionRecordings;
  const rf = schema.sessionRecordingFriction;
  return sql`(select ${column} from ${rf} where ${rf.recordingId} = ${r.id} and ${rf.processedChunks} = ${r.chunkCount})`;
}

function eventValueSql(column: AnyColumn): SQL {
  const r = schema.sessionRecordings;
  const f = schema.analyticsSessionFriction;
  return sql`(case when ${eventFrictionCoveredSql()} then (select ${column} from ${f} where ${f.tenantKey} = ${recordingTenantSql(r)} and ${f.sessionId} = ${r.sessionId}) end)`;
}

/** A signal's count for the outer recording, or null when unmeasured. */
function signalValueSql(signal: SessionFrictionSignal): SQL {
  if (signal in REPLAY_COLUMNS) {
    const key = REPLAY_COLUMNS[signal as ReplayFrictionSignal];
    return replayValueSql(schema.sessionRecordingFriction[key]);
  }
  const key = EVENT_COLUMNS[signal as EventFrictionSignal];
  return eventValueSql(schema.analyticsSessionFriction[key]);
}

/** Replay plus event score; null only when neither part was measured. */
function frictionScoreSql(): SQL {
  return sql`(select sum(part) from (values (${replayValueSql(schema.sessionRecordingFriction.score)}), (${eventValueSql(schema.analyticsSessionFriction.score)})) as friction_parts(part))`;
}

/**
 * Conditions on `session_recordings`: each signal must have happened in a
 * measured session. An unmeasured session never matches, before or after
 * the migration.
 */
export async function sessionFrictionFilterConditions(
  signals: readonly SessionFrictionSignal[] | undefined,
): Promise<SQL[]> {
  if (!signals?.length) return [];
  if (!(await sessionFrictionReady(getDb()))) return [sql`false`];
  return [...new Set(signals)].map(
    (signal) => sql`${signalValueSql(signal)} > 0`,
  );
}

/** Most friction first; unmeasured sessions last. Null before migration. */
export async function sessionFrictionSortOrder(
  sort: SessionFrictionSort,
): Promise<SQL | null> {
  if (!(await sessionFrictionReady(getDb()))) return null;
  const value = sort === "friction" ? frictionScoreSql() : signalValueSql(sort);
  return sql`${value} desc nulls last`;
}

export interface SessionFrictionRecording {
  id: string;
  clientRecordingId: string;
  sessionId: string;
  chunkCount: number;
  ownerEmail: string;
  orgId: string | null;
  errorCount: number;
  rageClickCount: number;
}

function unmeasuredFriction(
  errorIssues: SessionFriction["errorIssues"],
): SessionFriction {
  return {
    score: null,
    replay: null,
    events: null,
    topSignals: [],
    troubles: [],
    errorIssues,
  };
}

/**
 * Friction, trouble groups, and Monitoring issues for one page of recordings
 * the caller already listed through its access filter.
 */
export async function getSessionFrictionDetails(
  scope: ErrorReadScope,
  recordings: readonly SessionFrictionRecording[],
): Promise<Map<string, SessionFriction>> {
  const result = new Map<string, SessionFriction>();
  if (!recordings.length) return result;
  const db = getDb() as any;
  if (!(await sessionFrictionReady(db))) {
    // The issue lookup waits for the indexes the same migration adds.
    for (const recording of recordings) {
      result.set(recording.id, unmeasuredFriction(null));
    }
    return result;
  }
  const ids = recordings.map((recording) => recording.id);
  const r = schema.sessionRecordings;
  const rf = schema.sessionRecordingFriction;
  const f = schema.analyticsSessionFriction;
  const t = schema.analyticsSessionTrouble;

  const [replayRows, eventRows, issues] = await Promise.all([
    db.select().from(rf).where(inArray(rf.recordingId, ids)) as Promise<
      Array<typeof rf.$inferSelect>
    >,
    db
      .select({
        recordingId: r.id,
        covered: sql<boolean>`${eventFrictionCoveredSql()}`,
        tenantKey: f.tenantKey,
        sessionId: f.sessionId,
        failedActions: f.failedActions,
        stuckChats: f.stuckChats,
        thumbsDown: f.thumbsDown,
        cancelledRuns: f.cancelledRuns,
        agentFailures: f.agentFailures,
        quickBacks: f.quickBacks,
        score: f.score,
      })
      .from(r)
      .leftJoin(
        f,
        and(
          eq(f.tenantKey, recordingTenantSql(r)),
          eq(f.sessionId, r.sessionId),
        ),
      )
      .where(inArray(r.id, ids)),
    listRecordingErrorIssues(scope, recordings),
  ]);

  const replayById = new Map(replayRows.map((row) => [row.recordingId, row]));
  const eventsById = new Map<string, any>(
    eventRows.map((row: any) => [row.recordingId, row]),
  );
  const coveredSessions = eventRows.filter(
    (row: any) => row.covered === true && row.tenantKey,
  );
  const troublesBySession = new Map<string, SessionTroubleGroup[]>();
  if (coveredSessions.length) {
    const ranked = db
      .select({
        tenantKey: t.tenantKey,
        sessionId: t.sessionId,
        kind: t.kind,
        label: t.label,
        status: t.status,
        cause: t.cause,
        eventCount: t.eventCount,
        rank: sql<number>`row_number() over (partition by ${t.tenantKey}, ${t.sessionId} order by ${t.eventCount} desc, ${t.lastAt} desc, ${t.id})`.as(
          "rank",
        ),
      })
      .from(t)
      .where(
        and(
          inArray(t.tenantKey, [
            ...new Set<string>(
              coveredSessions.map((row: any) => row.tenantKey),
            ),
          ]),
          inArray(t.sessionId, [
            ...new Set<string>(
              coveredSessions.map((row: any) => row.sessionId),
            ),
          ]),
        ),
      )
      .as("ranked_trouble");
    const troubleRows = await db
      .select()
      .from(ranked)
      .where(lte(ranked.rank, TROUBLE_GROUPS_PER_SESSION));
    for (const row of troubleRows) {
      const key = JSON.stringify([row.tenantKey, row.sessionId]);
      const groups = troublesBySession.get(key) ?? [];
      groups.push({
        kind: row.kind,
        label: row.label,
        status: row.status ?? null,
        cause: isAgentTroubleCause(row.cause) ? row.cause : null,
        count: Number(row.eventCount),
      });
      troublesBySession.set(key, groups);
    }
  }

  for (const recording of recordings) {
    const replayRow = replayById.get(recording.id);
    const replay =
      replayRow && replayRow.processedChunks === recording.chunkCount
        ? replayCountsBySignal(replayRow)
        : null;
    const eventRow = eventsById.get(recording.id);
    const eventsCovered = eventRow?.covered === true && eventRow.tenantKey;
    const events = eventsCovered ? eventCountsBySignal(eventRow) : null;
    const errorIssues = issues.get(recording.id) ?? null;
    if (!replay && !events) {
      result.set(recording.id, unmeasuredFriction(errorIssues));
      continue;
    }
    const counts: FrictionCounts = {
      ...(replay
        ? {
            ...replay,
            errors: recording.errorCount,
            rage_clicks: recording.rageClickCount,
          }
        : {}),
      ...(events ?? {}),
    };
    // The stored scores, computed at ingest, are what the friction sort used.
    const score =
      (replay ? Number(replayRow!.score) : 0) +
      (events ? Number(eventRow.score) : 0);
    const troubles = events
      ? (troublesBySession.get(
          JSON.stringify([eventRow.tenantKey, eventRow.sessionId]),
        ) ?? [])
      : [];
    troubles.sort((a, b) => b.count - a.count);
    result.set(recording.id, {
      score,
      replay,
      events,
      topSignals: topSessionFrictionSignals(counts),
      troubles,
      errorIssues,
    });
  }
  return result;
}

export async function pruneSessionFriction(
  replayRetentionDays: number,
  now = new Date(),
): Promise<void> {
  const db = getDb() as any;
  if (!(await sessionFrictionReady(db))) return;
  const cutoff = new Date(
    now.getTime() -
      (replayRetentionDays + FRICTION_RETENTION_BUFFER_DAYS) * 24 * 60 * 60_000,
  ).toISOString();
  const rf = schema.sessionRecordingFriction;
  const f = schema.analyticsSessionFriction;
  const t = schema.analyticsSessionTrouble;
  // guard:allow-unscoped -- retention intentionally sweeps expired friction rows across tenants.
  await db.delete(rf).where(lt(rf.updatedAt, cutoff));
  // guard:allow-unscoped -- retention intentionally sweeps expired friction rows across tenants.
  await db.delete(f).where(lt(f.lastAt, cutoff));
  // A session's groups go with its counts, so a measured session never shows
  // only part of its trouble.
  // guard:allow-unscoped -- retention intentionally sweeps expired trouble groups across tenants.
  await db
    .delete(t)
    .where(
      and(
        lt(t.lastAt, cutoff),
        sql`not exists (select 1 from ${f} where ${f.tenantKey} = ${t.tenantKey} and ${f.sessionId} = ${t.sessionId})`,
      ),
    );
}

export function __resetSessionFrictionForTests(): void {
  lastWarnAt.clear();
  frictionTablesReady = false;
}
