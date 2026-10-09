import { createHash } from "node:crypto";

import {
  AGENT_SIGNALS_PAGEVIEW_PROPERTY,
  AGENT_SIGNALS_VERSION,
  AGENT_TROUBLE_CAUSES,
  agentErrorCodeForTelemetry,
  agentTroubleCauseForCode,
  isAgentTroubleCause,
  PAGE_LOAD_PAGEVIEW_PROPERTY,
} from "@agent-native/core/shared/analytics-events";
import { accessFilter } from "@agent-native/core/sharing";
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  EVENT_FRICTION_SCORE_INPUTS,
  EVENT_FRICTION_SIGNALS,
  type EventFrictionSignal,
  type FrictionCounts,
  isMarkedClientFrictionSignal,
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
import { boundedText } from "./indexed-text.js";
import {
  recordingTenantSql,
  type SessionEventIndexInputRow,
  type SessionEventScope,
  sessionEventTenantKey,
  sessionGapRows,
  sessionIdOf,
  viewerReadsRecordingEventsSql,
} from "./session-event-index.js";
import {
  detectReplayFriction,
  parseReplayFrictionDetectorState,
  type ReplayFrictionDelta,
  type ReplayFrictionDetectorState,
} from "./session-friction-detector.js";
import { sessionRecordingAssociationsReady } from "./session-recording-associations.js";

/**
 * Session friction, measured at ingest into Analytics' own Postgres tables so
 * no view reads the event store.
 *
 * Replay friction is per recording. A recording is measured only when its
 * first chunks arrived after the friction tables existed, and only while the
 * row has processed every chunk the recording stores. A chunk that never
 * arrives is skipped. A batch it misses, or a chunk that arrives after a later
 * one, leaves the counts short of the recording, so reads report it
 * unmeasured until the recording ends and is measured again from storage.
 *
 * Event friction is per analytics session and is written in a savepoint of
 * its own inside the session event index savepoint. A failed friction write
 * rolls back only friction and leaves a friction gap marker; a failed index
 * write leaves the index's gap marker, which covers friction too. A session is
 * measured only if it, its sibling recordings, and its indexed events all
 * began after its tenant's friction coverage began, and it has neither gap
 * marker. Its thumbs-down
 * and cancelled runs are measured only once a pageview carried the
 * `agent_signals` marker and no unmarked pageview or sampled stop arrived:
 * older clients sampled stops and sent no ratings, and one session id spans
 * every tab, so an old tab can share a session with a new one.
 */

const PAGEVIEW_EVENT = "pageview";
const ACTION_RESPONSE_EVENT = "action.response";
const RUN_OUTCOME_EVENT = "agent_run_outcome";
const STUCK_CHAT_EVENT = "agent_chat_stuck_detected";
const FEEDBACK_EVENT = "agent_feedback_submitted";

/** Back to the previous page within this long of leaving it is a quick back. */
export const QUICK_BACK_WINDOW_MS = 5_000;
/** A session keeps the navigation of only its most recent page loads. */
const MAX_NAV_PAGE_LOADS = 20;
const MAX_PAGE_LOAD_ID_LENGTH = 64;
const MAX_TROUBLE_LABEL_LENGTH = 120;
const MAX_TROUBLE_STATUS_LENGTH = 80;
const MAX_PATH_LENGTH = 2_000;
const TROUBLE_GROUPS_PER_RECORDING = 3;
const FRICTION_RETENTION_BUFFER_DAYS = 2;
const WARN_INTERVAL_MS = 60_000;

const lastWarnAt = new Map<string, number>();
let frictionTablesReady = false;
/** Tenants whose coverage row is known committed, so ingest skips the insert. */
const coveredTenants = new Set<string>();

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
  stalled_requests: "stalledRequests",
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

/** A stored chunk's events as JSON text, or `null` when they cannot be read. */
export interface StoredReplayChunk {
  seq: number;
  inlineData: string | null;
}

/** Every chunk a recording stores, in sequence order. */
export type ReadStoredReplayChunks = () => AsyncIterable<StoredReplayChunk>;

export interface ReplayFrictionInput {
  recordingId: string;
  sessionId: string;
  ownerEmail: string;
  orgId: string | null;
  /** Chunks the recording stored before this batch. */
  priorChunkCount: number;
  /** Chunks this batch stored, with the events they arrived with. */
  newChunks: ReadonlyArray<StoredReplayChunk>;
  /** The counts this batch wrote to the recording, so the score matches. */
  errorCount: number;
  rageClickCount: number;
  /** Whether the recording has ended, so an error near its end means leaving. */
  recordingEnded: boolean;
  /** Measures an ended recording again when its row fell behind. */
  readStoredChunks: ReadStoredReplayChunks;
  ingestedAt: string;
}

/**
 * Measures one ingested batch. Never fails the upload: a batch it cannot
 * measure leaves the row behind the recording, which reads as unmeasured.
 */
export async function recordReplayFriction(
  input: ReplayFrictionInput,
): Promise<void> {
  try {
    await measureReplayFriction(input);
  } catch (error) {
    warnFrictionFailure(
      "Replay friction write failed; the recording reads as unmeasured:",
      error,
    );
  }
}

/**
 * A recording that stopped uploading without a final flush ends when
 * retention finalizes it, so that is when an error near its last event first
 * counts as leaving. Throws, so retention can leave the recording active and
 * try again rather than end it with leaving uncounted.
 */
export async function finalizeReplayFriction(
  recording: {
    id: string;
    sessionId: string;
    ownerEmail: string;
    orgId: string | null;
    chunkCount: number;
    errorCount: number;
    rageClickCount: number;
  },
  finalizedAt: string,
  readStoredChunks: ReadStoredReplayChunks,
): Promise<void> {
  await measureReplayFriction({
    recordingId: recording.id,
    sessionId: recording.sessionId,
    ownerEmail: recording.ownerEmail,
    orgId: recording.orgId,
    priorChunkCount: recording.chunkCount,
    newChunks: [],
    errorCount: recording.errorCount,
    rageClickCount: recording.rageClickCount,
    recordingEnded: true,
    readStoredChunks,
    ingestedAt: finalizedAt,
  });
}

type ReplayFrictionRow = typeof schema.sessionRecordingFriction.$inferSelect;
type ReplayFrictionCounts = Record<
  (typeof REPLAY_COLUMNS)[ReplayFrictionSignal],
  number
>;

interface ReplayFrictionProgress {
  state: ReplayFrictionDetectorState;
  /** The highest chunk sequence measured so far. */
  lastSeq: number;
}

/**
 * A row written before chunk gaps were allowed has no `lastSeq`: it measured
 * chunks 0 through `processedChunks - 1`.
 */
function readReplayFrictionProgress(
  row: ReplayFrictionRow,
): ReplayFrictionProgress | null {
  const parsed = parseReplayFrictionDetectorState(row.detectorState);
  if (!parsed) return null;
  const { lastSeq, ...state } = parsed as ReplayFrictionDetectorState & {
    lastSeq?: unknown;
  };
  if (lastSeq === undefined) return { state, lastSeq: row.processedChunks - 1 };
  if (typeof lastSeq !== "number" || !Number.isFinite(lastSeq)) return null;
  return { state, lastSeq };
}

function parseReplayChunks(
  chunks: ReadonlyArray<StoredReplayChunk>,
): unknown[] | null {
  const events: unknown[] = [];
  for (const chunk of chunks) {
    const parsed =
      chunk.inlineData === null
        ? null
        : parseReplayEventsStrict(chunk.inlineData);
    if (!parsed) return null;
    events.push(...parsed);
  }
  return events;
}

/**
 * A batch with no new chunks, such as a retried upload or a final flush,
 * still rescores the row: the recording's counts, and whether it has ended,
 * can change without new events.
 */
async function measureReplayFriction(
  input: ReplayFrictionInput,
): Promise<void> {
  if (input.priorChunkCount === 0 && !input.newChunks.length) return;
  const db = getDb() as any;
  if (!(await sessionFrictionReady(db))) return;
  const t = schema.sessionRecordingFriction;
  let existing: ReplayFrictionRow | undefined;
  if (input.priorChunkCount > 0) {
    [existing] = await db
      .select()
      .from(t)
      .where(eq(t.recordingId, input.recordingId))
      .limit(1);
  }
  const progress = existing ? readReplayFrictionProgress(existing) : null;
  const newChunks = [...input.newChunks].sort((a, b) => a.seq - b.seq);
  // A lost upload leaves a gap in the sequence, which is skipped. A chunk that
  // arrives after a later one cannot be measured in order, so the row falls
  // behind until the recording ends and is measured again from storage.
  const continues =
    input.priorChunkCount === 0 ||
    (existing?.processedChunks === input.priorChunkCount &&
      progress !== null &&
      (newChunks.length === 0 || newChunks[0]!.seq > progress.lastSeq));
  const events = continues ? parseReplayChunks(newChunks) : null;
  if (!events) {
    if (input.recordingEnded) await remeasureReplayFriction(input);
    return;
  }
  const { state, delta, errorThenLeave } = detectReplayFriction(
    events,
    progress ? progress.state : null,
  );
  const lastChunk = newChunks[newChunks.length - 1];
  const written = await writeReplayFriction(input, existing, {
    counts: {
      deadClicks: (existing?.deadClicks ?? 0) + delta.deadClicks,
      errorToasts: (existing?.errorToasts ?? 0) + delta.errorToasts,
      retryLoops: (existing?.retryLoops ?? 0) + delta.retryLoops,
      errorThenLeave: errorThenLeave && input.recordingEnded ? 1 : 0,
      stalledRequests: (existing?.stalledRequests ?? 0) + delta.stalledRequests,
      http4xx: (existing?.http4xx ?? 0) + delta.http4xx,
      http5xx: (existing?.http5xx ?? 0) + delta.http5xx,
    },
    issueErrors: !existing
      ? delta.issueErrors
      : existing.issueErrors === null
        ? null
        : existing.issueErrors + delta.issueErrors,
    processedChunks: input.priorChunkCount + newChunks.length,
    progress: {
      state,
      lastSeq: lastChunk ? lastChunk.seq : progress!.lastSeq,
    },
  });
  // Another upload advanced the row first. An ended recording may get no
  // later upload to catch the row up, so it is measured again from storage.
  if (!written && input.recordingEnded) await remeasureReplayFriction(input);
}

const REMEASURE_ATTEMPTS = 3;

/**
 * Measures an ended recording from every chunk it stores, in sequence order.
 * A chunk that cannot be read leaves the row behind, which reads as
 * unmeasured. Throws while other writes keep advancing the row, so retention
 * leaves the recording active and tries again.
 */
async function remeasureReplayFriction(
  input: ReplayFrictionInput,
): Promise<void> {
  for (let attempt = 0; attempt < REMEASURE_ATTEMPTS; attempt += 1) {
    if ((await remeasureReplayFrictionOnce(input)) !== "lost") return;
  }
  throw new Error(
    `Replay friction for recording ${input.recordingId} kept changing while it was remeasured`,
  );
}

/** "lost" when another write advanced the row first, so nothing was saved. */
async function remeasureReplayFrictionOnce(
  input: ReplayFrictionInput,
): Promise<"saved" | "unmeasurable" | "lost"> {
  const t = schema.sessionRecordingFriction;
  const [existing]: Array<ReplayFrictionRow | undefined> = await (
    getDb() as any
  )
    .select()
    .from(t)
    .where(eq(t.recordingId, input.recordingId))
    .limit(1);
  const totals: ReplayFrictionDelta = {
    deadClicks: 0,
    errorToasts: 0,
    retryLoops: 0,
    stalledRequests: 0,
    http4xx: 0,
    http5xx: 0,
    issueErrors: 0,
  };
  let progress: ReplayFrictionProgress | null = null;
  let errorThenLeave = false;
  let processedChunks = 0;
  for await (const chunk of input.readStoredChunks()) {
    const events = parseReplayChunks([chunk]);
    if (!events) return "unmeasurable";
    const result = detectReplayFriction(
      events,
      progress ? progress.state : null,
    );
    for (const key of Object.keys(totals) as Array<keyof ReplayFrictionDelta>) {
      totals[key] += result.delta[key];
    }
    progress = { state: result.state, lastSeq: chunk.seq };
    errorThenLeave = result.errorThenLeave;
    processedChunks += 1;
  }
  if (!progress) return "unmeasurable";
  const written = await writeReplayFriction(input, existing, {
    counts: {
      deadClicks: totals.deadClicks,
      errorToasts: totals.errorToasts,
      retryLoops: totals.retryLoops,
      errorThenLeave: errorThenLeave ? 1 : 0,
      stalledRequests: totals.stalledRequests,
      http4xx: totals.http4xx,
      http5xx: totals.http5xx,
    },
    issueErrors: totals.issueErrors,
    processedChunks,
    progress,
  });
  return written ? "saved" : "lost";
}

/** Whether the row was written; false when another upload changed it first. */
async function writeReplayFriction(
  input: ReplayFrictionInput,
  existing: ReplayFrictionRow | undefined,
  measured: {
    counts: ReplayFrictionCounts;
    issueErrors: number | null;
    processedChunks: number;
    progress: ReplayFrictionProgress;
  },
): Promise<boolean> {
  const db = getDb() as any;
  const t = schema.sessionRecordingFriction;
  const score = sessionFrictionScore(
    {
      ...replayCountsBySignal(measured.counts),
      errors: input.errorCount,
      rage_clicks: input.rageClickCount,
    },
    REPLAY_FRICTION_SCORE_INPUTS,
  );
  const values = {
    ...measured.counts,
    issueErrors: measured.issueErrors,
    processedChunks: measured.processedChunks,
    score,
    detectorState: JSON.stringify({
      ...measured.progress.state,
      lastSeq: measured.progress.lastSeq,
    }),
    updatedAt: input.ingestedAt,
  };
  if (existing) {
    // Conditional on the count read above, so two overlapping uploads can
    // never both advance the same row.
    const updated = await db
      .update(t)
      .set(values)
      .where(
        and(
          eq(t.recordingId, input.recordingId),
          eq(t.processedChunks, existing.processedChunks),
        ),
      )
      .returning({ recordingId: t.recordingId });
    return updated.length > 0;
  }
  const inserted = await db
    .insert(t)
    .values({
      recordingId: input.recordingId,
      tenantKey: sessionEventTenantKey(input.ownerEmail, input.orgId),
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
      sessionId: input.sessionId,
      ...values,
    })
    .onConflictDoNothing()
    .returning({ recordingId: t.recordingId });
  return inserted.length > 0;
}

function replayCountsBySignal(
  row: ReplayFrictionCounts,
): Record<ReplayFrictionSignal, number> {
  return Object.fromEntries(
    REPLAY_FRICTION_SIGNALS.map((signal) => [
      signal,
      Number(row[REPLAY_COLUMNS[signal]] ?? 0),
    ]),
  ) as Record<ReplayFrictionSignal, number>;
}

/** Counts by signal; marked-client signals are null until measured. */
function eventCountsBySignal(
  row: Record<(typeof EVENT_COLUMNS)[EventFrictionSignal], number | null> & {
    agentSignalsMeasured?: boolean | null;
    agentSignalsMissing?: boolean | null;
  },
): Record<EventFrictionSignal, number | null> {
  const agentSignalsMeasured =
    row.agentSignalsMeasured === true && row.agentSignalsMissing === false;
  return Object.fromEntries(
    EVENT_FRICTION_SIGNALS.map((signal) => [
      signal,
      isMarkedClientFrictionSignal(signal) && !agentSignalsMeasured
        ? null
        : Number(row[EVENT_COLUMNS[signal]] ?? 0),
    ]),
  ) as Record<EventFrictionSignal, number | null>;
}

function combineEventCounts(
  rows: readonly Parameters<typeof eventCountsBySignal>[0][],
): Record<EventFrictionSignal, number | null> {
  const sessionCounts = rows.map(eventCountsBySignal);
  return Object.fromEntries(
    EVENT_FRICTION_SIGNALS.map((signal) => {
      const values = sessionCounts.map((counts) => counts[signal]);
      return [
        signal,
        values.some((value) => value === null)
          ? null
          : values.reduce<number>((sum, value) => sum + Number(value), 0),
      ];
    }),
  ) as Record<EventFrictionSignal, number | null>;
}

function measuredCounts(
  counts: Partial<Record<string, number | null>>,
): FrictionCounts {
  return Object.fromEntries(
    Object.entries(counts).filter(([, count]) => typeof count === "number"),
  ) as FrictionCounts;
}

interface PageLoadNav {
  previous: string | null;
  current: string;
  at: number;
}

/** Each page load's navigation, least recently navigated first. */
type NavState = Map<string, PageLoadNav>;

function parseNavState(raw: string | null): NavState {
  if (raw === null) return new Map();
  const parsed = JSON.parse(raw) as {
    v?: unknown;
    loads?: Array<PageLoadNav & { id: string }>;
  };
  if (parsed?.v !== 2 || !Array.isArray(parsed.loads)) {
    throw new Error("Session friction navigation state is unreadable");
  }
  return new Map(parsed.loads.map(({ id, ...load }) => [id, load]));
}

function serializeNavState(nav: NavState): string {
  return JSON.stringify({
    v: 2,
    loads: [...nav].map(([id, load]) => ({ id, ...load })),
  });
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
        agentSignalsMeasured: false,
        agentSignalsMissing: false,
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
        // Older clients sampled stops, so one event is not one stop, and the
        // session's other stops went unreported.
        if (
          properties.sample_rate === undefined ||
          properties.sample_rate === 1
        ) {
          session.cancelledRuns = (session.cancelledRuns ?? 0) + 1;
        } else {
          session.agentSignalsMissing = true;
        }
        continue;
      }
      if (
        properties.outcome !== "failed" &&
        properties.outcome !== "interrupted"
      ) {
        continue;
      }
      session.agentFailures = (session.agentFailures ?? 0) + 1;
      const rawCode = stringProperty(properties.code);
      // Older clients sent any code they were given, even a sentence.
      const code = agentErrorCodeForTelemetry(rawCode);
      // Older recorders send no cause, so the same list names it here.
      const cause = isAgentTroubleCause(properties.cause)
        ? properties.cause
        : agentTroubleCauseForCode(rawCode);
      if (cause) {
        addTrouble("agent", cause, code, cause, ["cause", cause]);
        continue;
      }
      // Never by message text, which can name a person or a document.
      const label = code || String(properties.outcome);
      addTrouble("agent", label, code, null, ["code", label]);
      continue;
    }

    const agentSignals = properties[AGENT_SIGNALS_PAGEVIEW_PROPERTY];
    if (
      typeof agentSignals === "number" &&
      agentSignals >= AGENT_SIGNALS_VERSION
    ) {
      session.agentSignalsMeasured = true;
    } else {
      session.agentSignalsMissing = true;
    }
    const path = boundedText(stringProperty(properties.path), MAX_PATH_LENGTH);
    const at = Date.parse(row.timestamp);
    if (!path || !Number.isFinite(at)) continue;
    const page = shortHash(path);
    // One session id spans every tab, so only a page load's own navigation
    // can come back to its previous page. Older clients send no id, so their
    // quick backs are unmeasured rather than counted across tabs.
    const loadId = boundedText(
      stringProperty(properties[PAGE_LOAD_PAGEVIEW_PROPERTY]),
      MAX_PAGE_LOAD_ID_LENGTH,
    );
    if (!loadId) continue;
    const load = session.nav.get(loadId);
    if (load && (page === load.current || at < load.at)) continue;
    if (
      load &&
      page === load.previous &&
      at - load.at <= QUICK_BACK_WINDOW_MS
    ) {
      session.quickBacks = (session.quickBacks ?? 0) + 1;
    }
    session.nav.delete(loadId);
    session.nav.set(loadId, {
      previous: load?.current ?? null,
      current: page,
      at,
    });
    if (session.nav.size > MAX_NAV_PAGE_LOADS) {
      session.nav.delete(session.nav.keys().next().value!);
    }
    session.navState = serializeNavState(session.nav);
  }

  return {
    sessions: [...sessions.values()]
      .map(({ nav: _nav, ...session }) => ({
        ...session,
        score: sessionFrictionScore(
          measuredCounts(eventCountsBySignal(session as any)),
          EVENT_FRICTION_SCORE_INPUTS,
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    troubles: [...troubles.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * The event score of a row after the upsert adds this batch's counts. A
 * marked-client signal scores only while the merged row is measured for it.
 */
function mergedEventScoreSql(): SQL {
  const f = schema.analyticsSessionFriction;
  return sql.join(
    EVENT_FRICTION_SIGNALS.map((signal) => {
      const column = f[EVENT_COLUMNS[signal]];
      const part = sql`${sql.raw(String(SESSION_FRICTION_WEIGHTS[signal]))} * least(${column} + ${sql.raw(`excluded.${column.name}`)}, ${sql.raw(String(SESSION_FRICTION_SIGNAL_CAP))})`;
      return isMarkedClientFrictionSignal(signal)
        ? sql`(case when (${f.agentSignalsMeasured} or excluded.agent_signals_measured) and not (${f.agentSignalsMissing} or excluded.agent_signals_missing) then ${part} else 0 end)`
        : part;
    }),
    sql` + `,
  );
}

/**
 * Runs inside the session event index savepoint, in a savepoint of its own,
 * so a friction failure never costs the index its write. A failed friction
 * write leaves a friction gap marker for the batch's sessions instead; only a
 * failed marker throws, and the index then rolls back and marks its own gap.
 * The readiness probe belongs inside the savepoint too: a failed query aborts
 * the transaction it runs in.
 */
export async function recordSessionEventFriction(
  tx: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  try {
    await tx.transaction(async (savepoint: any) => {
      if (await sessionFrictionReady(savepoint)) {
        await writeSessionEventFriction(savepoint, rows, receivedAt);
      }
    });
  } catch (error) {
    // A later batch can still write these sessions' friction, so without the
    // marker their counts would read as complete.
    const gaps = sessionGapRows("asfg", rows, receivedAt);
    if (gaps.length) {
      await tx
        .insert(schema.analyticsSessionFrictionGaps)
        .values(gaps)
        .onConflictDoNothing();
    }
    warnFrictionFailure(
      "Session friction write failed; its sessions read as unmeasured:",
      error,
    );
  }
}

async function writeSessionEventFriction(
  savepoint: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
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
  // Only a batch that upserted a session's pageview index row earlier in
  // this transaction writes its nav state. That row lock makes a concurrent
  // batch for the session wait for this one to commit before it reads here,
  // so friction must keep running after the index, inside its transaction.
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
        agentSignalsMeasured: sql`${f.agentSignalsMeasured} or excluded.agent_signals_measured`,
        agentSignalsMissing: sql`${f.agentSignalsMissing} or excluded.agent_signals_missing`,
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
    if (coveredTenants.has(session.tenantKey)) continue;
    tenants.set(session.tenantKey, {
      ownerEmail: session.ownerEmail,
      orgId: session.orgId ?? null,
    });
  }
  if (!tenants.size) return;
  const inserted: Array<{ tenantKey: string }> = await savepoint
    .insert(schema.analyticsSessionFrictionCoverage)
    .values(
      [...tenants.entries()].map(([tenantKey, tenant]) => ({
        tenantKey,
        ownerEmail: tenant.ownerEmail,
        orgId: tenant.orgId,
        startedAt: receivedAt,
      })),
    )
    .onConflictDoNothing()
    .returning({
      tenantKey: schema.analyticsSessionFrictionCoverage.tenantKey,
    });
  // A conflict means another transaction committed the row. A row inserted
  // here can still roll back with the ingest, so only the next batch caches it.
  const insertedNow = new Set(inserted.map((row) => row.tenantKey));
  for (const tenantKey of tenants.keys()) {
    if (!insertedNow.has(tenantKey)) coveredTenants.add(tenantKey);
  }
}

/** True when the recording's session events were measured completely. */
function eventFrictionCoveredSql(
  scope: SessionEventScope,
  associationsReady: boolean,
): SQL {
  const r = schema.sessionRecordings;
  const coverage = schema.analyticsSessionFrictionCoverage;
  const gaps = schema.analyticsSessionEventGaps;
  const frictionGaps = schema.analyticsSessionFrictionGaps;
  const events = schema.analyticsSessionEvents;
  const tenant = recordingTenantSql(r);
  const coverageStart = sql`(select ${coverage.startedAt} from ${coverage} where ${coverage.tenantKey} = ${tenant})`;
  if (!associationsReady) {
    const sibling = alias(
      schema.sessionRecordings,
      "session_friction_legacy_sibling",
    );
    // Before the association migration lands, reads retain the legacy session lookup.
    return sql`(
      ${viewerReadsRecordingEventsSql(r, scope)}
      and ${r.startedAt} >= ${coverageStart}
      and not exists (
        select 1 from ${schema.sessionRecordings} as ${sibling}
        where ${sibling.sessionId} = ${r.sessionId}
          and ${recordingTenantSql(sibling)} = ${tenant}
          and ${sibling.startedAt} < ${coverageStart}
      )
      and not exists (
        select 1 from ${events}
        where ${events.tenantKey} = ${tenant}
          and ${events.sessionId} = ${r.sessionId}
          and ${events.firstAt} < ${coverageStart}
      )
      and not exists (
        select 1 from ${gaps}
        where ${gaps.tenantKey} = ${tenant}
          and ${gaps.sessionId} = ${r.sessionId}
      )
      and not exists (
        select 1 from ${frictionGaps}
        where ${frictionGaps.tenantKey} = ${tenant}
          and ${frictionGaps.sessionId} = ${r.sessionId}
      )
    )`;
  }
  const sibling = alias(schema.sessionRecordings, "session_friction_sibling");
  const siblingAssociation = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_sibling_association",
  );
  const siblingAnyAssociation = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_sibling_any_association",
  );
  const association = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_association",
  );
  const anyAssociation = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_any_association",
  );
  const incompleteAssociation = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_incomplete_association",
  );
  const associationComplete = (candidate: { sessionId: AnyColumn }) =>
    sql`${r.startedAt} >= ${coverageStart}
      and not exists (
        select 1 from ${schema.sessionRecordings} as ${sibling}
        where (
          exists (
            select 1 from ${schema.sessionRecordingSessionAssociations} as ${siblingAssociation}
            where ${siblingAssociation.recordingId} = ${sibling.id}
              and ${siblingAssociation.sessionId} = ${candidate.sessionId}
          )
          or (
            ${sibling.sessionId} = ${candidate.sessionId}
            and not exists (
              select 1 from ${schema.sessionRecordingSessionAssociations} as ${siblingAnyAssociation}
              where ${siblingAnyAssociation.recordingId} = ${sibling.id}
            )
          )
        )
          and ${recordingTenantSql(sibling)} = ${tenant}
          and ${sibling.startedAt} < ${coverageStart}
      )
      and not exists (
        select 1 from ${events}
        where ${events.tenantKey} = ${tenant}
          and ${events.sessionId} = ${candidate.sessionId}
          and ${events.firstAt} < ${coverageStart}
      )
      and not exists (
        select 1 from ${gaps}
        where ${gaps.tenantKey} = ${tenant}
          and ${gaps.sessionId} = ${candidate.sessionId}
      )
      and not exists (
        select 1 from ${frictionGaps}
        where ${frictionGaps.tenantKey} = ${tenant}
          and ${frictionGaps.sessionId} = ${candidate.sessionId}
      )`;
  // The event index predates friction coverage, so an event it holds from
  // before coverage began is one friction never aggregated.
  return sql`(
    ${viewerReadsRecordingEventsSql(r, scope)}
    and (
      (
        exists (
          select 1 from ${schema.sessionRecordingSessionAssociations} as ${anyAssociation}
          where ${anyAssociation.recordingId} = ${r.id}
        )
        and exists (
          select 1 from ${schema.sessionRecordingSessionAssociations} as ${association}
          where ${association.recordingId} = ${r.id}
            and ${associationComplete(association)}
        )
        and not exists (
          select 1 from ${schema.sessionRecordingSessionAssociations} as ${incompleteAssociation}
          where ${incompleteAssociation.recordingId} = ${r.id}
            and not (${associationComplete(incompleteAssociation)})
        )
      )
      or (
        not exists (
          select 1 from ${schema.sessionRecordingSessionAssociations} as ${anyAssociation}
          where ${anyAssociation.recordingId} = ${r.id}
        )
        and ${r.sessionId} is not null
        and ${associationComplete({ sessionId: r.sessionId })}
      )
    )
  )`;
}

function replayValueSql(column: AnyColumn): SQL {
  const r = schema.sessionRecordings;
  const rf = schema.sessionRecordingFriction;
  return sql`(select ${column} from ${rf} where ${rf.recordingId} = ${r.id} and ${rf.processedChunks} = ${r.chunkCount})`;
}

function eventValueSql(
  scope: SessionEventScope,
  column: AnyColumn,
  associationsReady: boolean,
  markedClient = false,
): SQL {
  const r = schema.sessionRecordings;
  const f = schema.analyticsSessionFriction;
  if (!associationsReady) {
    return sql`(
      case when ${eventFrictionCoveredSql(scope, false)} then (
        select ${column}
        from ${f}
        where ${f.tenantKey} = ${recordingTenantSql(r)}
          and ${f.sessionId} = ${r.sessionId}
          ${markedClient ? sql`and ${f.agentSignalsMeasured} and not ${f.agentSignalsMissing}` : sql``}
      ) end
    )`;
  }
  const association = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_value_association",
  );
  const missingAssociation = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_missing_association",
  );
  const anyAssociation = alias(
    schema.sessionRecordingSessionAssociations,
    "session_friction_value_any_association",
  );
  const hasMeasuredValue = (candidate: { sessionId: AnyColumn }) =>
    sql`exists (
      select 1 from ${f}
      where ${f.tenantKey} = ${recordingTenantSql(r)}
        and ${f.sessionId} = ${candidate.sessionId}
      ${markedClient ? sql`and ${f.agentSignalsMeasured} and not ${f.agentSignalsMissing}` : sql``}
    )`;
  return sql`(
    case when ${eventFrictionCoveredSql(scope, true)} then
      case when exists (
        select 1 from ${schema.sessionRecordingSessionAssociations} as ${anyAssociation}
        where ${anyAssociation.recordingId} = ${r.id}
      ) then case when not exists (
        select 1 from ${schema.sessionRecordingSessionAssociations} as ${missingAssociation}
        where ${missingAssociation.recordingId} = ${r.id}
          and not ${hasMeasuredValue(missingAssociation)}
      ) then (
        select sum(${column})
        from ${schema.sessionRecordingSessionAssociations} as ${association}
        inner join ${f}
          on ${f.tenantKey} = ${recordingTenantSql(r)}
          and ${f.sessionId} = ${association.sessionId}
        where ${association.recordingId} = ${r.id}
          ${markedClient ? sql`and ${f.agentSignalsMeasured} and not ${f.agentSignalsMissing}` : sql``}
      ) end else case when ${hasMeasuredValue({ sessionId: r.sessionId })}
        then (
          select ${column}
          from ${f}
          where ${f.tenantKey} = ${recordingTenantSql(r)}
            and ${f.sessionId} = ${r.sessionId}
            ${markedClient ? sql`and ${f.agentSignalsMeasured} and not ${f.agentSignalsMissing}` : sql``}
        )
      end end
    end
  )`;
}

/** A signal's count for the outer recording, or null when unmeasured. */
function signalValueSql(
  scope: SessionEventScope,
  signal: SessionFrictionSignal,
  associationsReady: boolean,
): SQL {
  if (signal in REPLAY_COLUMNS) {
    const key = REPLAY_COLUMNS[signal as ReplayFrictionSignal];
    return replayValueSql(schema.sessionRecordingFriction[key]);
  }
  const key = EVENT_COLUMNS[signal as EventFrictionSignal];
  return eventValueSql(
    scope,
    schema.analyticsSessionFriction[key],
    associationsReady,
    isMarkedClientFrictionSignal(signal),
  );
}

/** Replay plus event score; null only when neither part was measured. */
function frictionScoreSql(
  scope: SessionEventScope,
  associationsReady: boolean,
): SQL {
  return sql`(select sum(part) from (values (${replayValueSql(schema.sessionRecordingFriction.score)}), (${eventValueSql(scope, schema.analyticsSessionFriction.score, associationsReady)})) as friction_parts(part))`;
}

/**
 * Conditions on `session_recordings`: each signal must have happened in a
 * measured session. An unmeasured session never matches, before or after
 * the migration.
 */
export async function sessionFrictionFilterConditions(
  scope: SessionEventScope,
  signals: readonly SessionFrictionSignal[] | undefined,
): Promise<SQL[]> {
  if (!signals?.length) return [];
  const db = getDb();
  if (!(await sessionFrictionReady(db))) return [sql`false`];
  const associationsReady = await sessionRecordingAssociationsReady(db);
  return [...new Set(signals)].map(
    (signal) => sql`${signalValueSql(scope, signal, associationsReady)} > 0`,
  );
}

/**
 * When friction coverage began for the viewer's own tenants (their org and
 * personal recordings): the latest start among tenants with coverage, or null
 * when nothing is measured yet or a tenant without coverage has recordings
 * the viewer sees in the range. Sessions that started earlier never match a
 * friction filter.
 */
export async function getSessionFrictionCoverageStart(
  scope: SessionEventScope,
  range: { from?: string; to?: string } = {},
): Promise<string | null> {
  const db = getDb() as any;
  if (!(await sessionFrictionReady(db))) return null;
  const coverage = schema.analyticsSessionFrictionCoverage;
  const tenants = (scope.orgId ? [scope.orgId, null] : [null]).map((orgId) => ({
    orgId,
    tenantKey: sessionEventTenantKey(scope.userEmail, orgId),
  }));
  const rows: Array<{ tenantKey: string; startedAt: string }> = await db
    .select({ tenantKey: coverage.tenantKey, startedAt: coverage.startedAt })
    .from(coverage)
    .where(
      inArray(
        coverage.tenantKey,
        tenants.map((tenant) => tenant.tenantKey),
      ),
    )
    .limit(tenants.length);
  const starts = new Map(rows.map((row) => [row.tenantKey, row.startedAt]));
  const r = schema.sessionRecordings;
  const uncoveredWithRecordings = await Promise.all(
    tenants
      .filter((tenant) => !starts.has(tenant.tenantKey))
      .map(async (tenant) => {
        const [recording] = await db
          .select({ id: r.id })
          .from(r)
          .where(
            and(
              accessFilter(r, schema.sessionRecordingShares, {
                userEmail: scope.userEmail,
                orgId: scope.orgId ?? undefined,
              }),
              tenant.orgId
                ? eq(r.orgId, tenant.orgId)
                : and(isNull(r.orgId), eq(r.ownerEmail, scope.userEmail)),
              range.from ? gte(r.startedAt, range.from) : undefined,
              range.to ? lte(r.startedAt, range.to) : undefined,
            ),
          )
          .limit(1);
        return recording !== undefined;
      }),
  );
  if (uncoveredWithRecordings.includes(true)) return null;
  let latest: string | null = null;
  for (const startedAt of starts.values()) {
    if (latest === null || startedAt > latest) latest = startedAt;
  }
  return latest;
}

/** Most friction first; unmeasured sessions last. Null before migration. */
export async function sessionFrictionSortOrder(
  scope: SessionEventScope,
  sort: SessionFrictionSort,
): Promise<SQL | null> {
  const db = getDb();
  if (!(await sessionFrictionReady(db))) return null;
  const associationsReady = await sessionRecordingAssociationsReady(db);
  const value =
    sort === "friction"
      ? frictionScoreSql(scope, associationsReady)
      : signalValueSql(scope, sort, associationsReady);
  return sql`${value} desc nulls last`;
}

export interface SessionFrictionRecording {
  id: string;
  clientRecordingId: string;
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
export function buildSessionTroubleQuery(
  db: any,
  eligibleRecordingIds: readonly string[],
  associationsReady: boolean,
) {
  const r = schema.sessionRecordings;
  const f = schema.analyticsSessionFriction;
  const t = schema.analyticsSessionTrouble;
  const safeCause = sql<
    string | null
  >`case when ${inArray(t.cause, [...AGENT_TROUBLE_CAUSES])}
    then ${t.cause} else null end`;
  let troubleQuery = db
    .select({
      recordingId: r.id,
      kind: t.kind,
      label: t.label,
      status: t.status,
      cause: safeCause.as("cause"),
      count: sql<number>`sum(${t.eventCount})`.as("count"),
    })
    .from(r)
    .where(inArray(r.id, [...eligibleRecordingIds]));
  if (associationsReady) {
    const association = schema.sessionRecordingSessionAssociations;
    const eventSessionId = sql`case when ${association.recordingId} is null
      then ${r.sessionId} else ${association.sessionId} end`;
    troubleQuery = troubleQuery.leftJoin(
      association,
      eq(association.recordingId, r.id),
    );
    troubleQuery = troubleQuery.innerJoin(
      f,
      and(
        eq(f.tenantKey, recordingTenantSql(r)),
        sql`${f.sessionId} = ${eventSessionId}`,
      ),
    );
  } else {
    troubleQuery = troubleQuery.innerJoin(
      f,
      and(eq(f.tenantKey, recordingTenantSql(r)), eq(f.sessionId, r.sessionId)),
    );
  }
  troubleQuery = troubleQuery.innerJoin(
    t,
    and(eq(t.tenantKey, f.tenantKey), eq(t.sessionId, f.sessionId)),
  );
  const groupedTroubles = troubleQuery
    // Use the selected sanitized cause: repeating its whitelist binds changes the GROUP BY expression.
    .groupBy(r.id, t.kind, t.label, t.status, sql.raw("5"))
    .as("grouped_troubles");
  const rankedTroubles = db
    .select({
      recordingId: groupedTroubles.recordingId,
      kind: groupedTroubles.kind,
      label: groupedTroubles.label,
      status: groupedTroubles.status,
      cause: groupedTroubles.cause,
      count: groupedTroubles.count,
      rank: sql<number>`row_number() over (
        partition by ${groupedTroubles.recordingId}
        order by ${groupedTroubles.count} desc,
          ${groupedTroubles.label} asc,
          ${groupedTroubles.kind} asc,
          ${groupedTroubles.status} asc,
          ${groupedTroubles.cause} asc
      )`.as("rank"),
    })
    .from(groupedTroubles)
    .where(inArray(groupedTroubles.recordingId, [...eligibleRecordingIds]))
    .as("ranked_troubles");
  return db
    .select({
      recordingId: rankedTroubles.recordingId,
      kind: rankedTroubles.kind,
      label: rankedTroubles.label,
      status: rankedTroubles.status,
      cause: rankedTroubles.cause,
      count: rankedTroubles.count,
    })
    .from(rankedTroubles)
    .where(lte(rankedTroubles.rank, TROUBLE_GROUPS_PER_RECORDING))
    .orderBy(asc(rankedTroubles.recordingId), asc(rankedTroubles.rank));
}

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
  const associationsReady = await sessionRecordingAssociationsReady(db);
  const ids = recordings.map((recording) => recording.id);
  const r = schema.sessionRecordings;
  const rf = schema.sessionRecordingFriction;
  const f = schema.analyticsSessionFriction;
  const t = schema.analyticsSessionTrouble;

  const replayRows: Array<typeof rf.$inferSelect> = await db
    .select()
    .from(rf)
    .where(inArray(rf.recordingId, ids));
  const replayById = new Map(replayRows.map((row) => [row.recordingId, row]));
  const completeReplayRow = (recording: SessionFrictionRecording) => {
    const row = replayById.get(recording.id);
    return row && row.processedChunks === recording.chunkCount
      ? row
      : undefined;
  };
  let eventRowsQuery = db
    .select({
      recordingId: r.id,
      covered: sql<boolean>`${eventFrictionCoveredSql(scope, associationsReady)}`,
      tenantKey: f.tenantKey,
      sessionId: f.sessionId,
      failedActions: f.failedActions,
      stuckChats: f.stuckChats,
      thumbsDown: f.thumbsDown,
      cancelledRuns: f.cancelledRuns,
      agentFailures: f.agentFailures,
      quickBacks: f.quickBacks,
      agentSignalsMeasured: f.agentSignalsMeasured,
      agentSignalsMissing: f.agentSignalsMissing,
      score: f.score,
    })
    .from(r)
    .where(inArray(r.id, ids));
  if (associationsReady) {
    const association = schema.sessionRecordingSessionAssociations;
    const eventSessionId = sql`case when ${association.recordingId} is null
      then ${r.sessionId} else ${association.sessionId} end`;
    eventRowsQuery = eventRowsQuery
      .leftJoin(association, eq(association.recordingId, r.id))
      .leftJoin(
        f,
        and(
          eq(f.tenantKey, recordingTenantSql(r)),
          sql`${f.sessionId} = ${eventSessionId}`,
        ),
      );
  } else {
    eventRowsQuery = eventRowsQuery.leftJoin(
      f,
      and(eq(f.tenantKey, recordingTenantSql(r)), eq(f.sessionId, r.sessionId)),
    );
  }
  const [eventRows, issues] = await Promise.all([
    eventRowsQuery,
    listRecordingErrorIssues(
      scope,
      recordings.map((recording) => ({
        ...recording,
        issueErrorCount: completeReplayRow(recording)?.issueErrors ?? null,
      })),
    ),
  ]);

  const eventRowsById = new Map<string, any[]>();
  for (const row of eventRows) {
    const rows = eventRowsById.get(row.recordingId) ?? [];
    rows.push(row);
    eventRowsById.set(row.recordingId, rows);
  }
  const eligibleRecordingIds = recordings.flatMap((recording) => {
    const rows = eventRowsById.get(recording.id) ?? [];
    return rows.length > 0 &&
      rows.every(
        (row) => row.covered === true && row.tenantKey && row.sessionId,
      )
      ? [recording.id]
      : [];
  });
  const troubleRows: Array<{
    recordingId: string;
    kind: string;
    label: string;
    status: string | null;
    cause: string | null;
    count: number | string;
  }> = eligibleRecordingIds.length
    ? await buildSessionTroubleQuery(
        db,
        eligibleRecordingIds,
        associationsReady,
      )
    : [];
  const troublesByRecording = new Map<string, SessionTroubleGroup[]>();
  for (const row of troubleRows) {
    if (row.kind !== "agent" && row.kind !== "action") {
      throw new Error("Session trouble query returned an unknown kind");
    }
    const groups = troublesByRecording.get(row.recordingId) ?? [];
    groups.push({
      kind: row.kind,
      label: row.label,
      status: row.status,
      cause: isAgentTroubleCause(row.cause) ? row.cause : null,
      count: Number(row.count),
    });
    troublesByRecording.set(row.recordingId, groups);
  }

  for (const recording of recordings) {
    const replayRow = completeReplayRow(recording);
    const replay = replayRow ? replayCountsBySignal(replayRow) : null;
    const sessionEventRows = eventRowsById.get(recording.id) ?? [];
    const eventsCovered =
      sessionEventRows.length > 0 &&
      sessionEventRows.every(
        (row) => row.covered === true && row.tenantKey && row.sessionId,
      );
    const events = eventsCovered ? combineEventCounts(sessionEventRows) : null;
    const eventScore = eventsCovered
      ? sessionEventRows.reduce((sum, row) => sum + Number(row.score ?? 0), 0)
      : 0;
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
      ...measuredCounts(events ?? {}),
    };
    // The stored scores, computed at ingest, are what the friction sort used.
    const score = (replay ? Number(replayRow!.score) : 0) + eventScore;
    const troubles = events
      ? (troublesByRecording.get(recording.id) ?? [])
      : [];
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

/** Friction for specific recordings, such as one list page's rows. */
export async function listRecordingFriction(
  scope: ErrorReadScope,
  recordingIds: readonly string[],
): Promise<Record<string, SessionFriction>> {
  const ids = [...new Set(recordingIds)];
  if (!ids.length) return {};
  const r = schema.sessionRecordings;
  const recordings: SessionFrictionRecording[] = await (getDb() as any)
    .select({
      id: r.id,
      clientRecordingId: r.clientRecordingId,
      chunkCount: r.chunkCount,
      ownerEmail: r.ownerEmail,
      orgId: r.orgId,
      errorCount: r.errorCount,
      rageClickCount: r.rageClickCount,
    })
    .from(r)
    .where(
      and(
        accessFilter(r, schema.sessionRecordingShares, {
          userEmail: scope.userEmail,
          orgId: scope.orgId ?? undefined,
        }),
        inArray(r.id, ids),
      ),
    )
    .limit(ids.length);
  return Object.fromEntries(await getSessionFrictionDetails(scope, recordings));
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
  const gaps = schema.analyticsSessionFrictionGaps;
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
  // A gap outlives its session's counts, so a later batch can never make the
  // session read as complete.
  // guard:allow-unscoped -- retention intentionally sweeps expired friction gap markers across tenants.
  await db
    .delete(gaps)
    .where(
      and(
        lt(gaps.recordedAt, cutoff),
        sql`not exists (select 1 from ${f} where ${f.tenantKey} = ${gaps.tenantKey} and ${f.sessionId} = ${gaps.sessionId})`,
      ),
    );
}

export function __resetSessionFrictionForTests(): void {
  lastWarnAt.clear();
  coveredTenants.clear();
  frictionTablesReady = false;
}
