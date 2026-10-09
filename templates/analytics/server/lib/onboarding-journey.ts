import { lexAgentSql } from "@agent-native/core/agent-sql";
import { getAppBasePath, getRequestContext } from "@agent-native/core/server";

import {
  queryFirstPartyAnalytics,
  type AnalyticsScope,
} from "./first-party-analytics.js";
import {
  buildOnboardingJourneyEventsSql,
  buildOnboardingJourneyFollowupSql,
  type OnboardingJourneyEventsFilters,
  type OnboardingJourneyObservationWindow,
  type OnboardingJourneyTerminalStep,
} from "./first-party-metric-catalog.js";
import {
  projectSessionSteps,
  type JourneyEventRow,
  type JourneyStep,
} from "./journey-steps.js";
import {
  buildJourneyTree,
  addDeeperCounts,
  type JourneyNode,
  type JourneyRecording,
  type JourneySession,
  type ViewportConstraints,
} from "./journey-tree.js";
import { listJourneyRecordings } from "./session-replay.js";

// Both backends cap a query result at 5,000 rows; stay under it so a full page
// is never mistaken for a cut one.
const EVENT_PAGE_ROWS = 4_000;
const MAX_FOLLOWUP_QUERY_CHARS = 800_000;
const MAX_FOLLOWUP_QUERY_TOKENS = 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OnboardingJourneyArgs extends OnboardingJourneyEventsFilters {
  format: "tree" | "summary";
  maxDepth: number;
  minNodeSessions: number;
  examplesPerNode: number;
  maxEventRows: number;
  maxNodes: number;
  settleMs: number;
  recency: "newest" | "none";
  viewport?: ViewportConstraints;
}

/** The contract other agents build against; field names are fixed. */
export interface JourneyTree {
  window: { from: string; to: string };
  app: string;
  rootN: number;
  coverage: {
    /** Sessions in the tree: entered onboarding in the window and produced a step. */
    sessionsWithEvents: number;
    /** Sessions with a playable recording the caller can open. */
    sessionsWithReplay: number;
    /** Counts are a partial sample: the event read or the node list was cut. */
    truncated: boolean;
  };
  nodes: JourneyNode[];
  followUp: JourneyFollowup;
  /** Home chat setup sessions that did not enter onboarding, with a separate denominator. */
  standaloneSetup?: {
    rootN: number;
    coverage: {
      sessionsWithEvents: number;
      sessionsWithReplay: number;
      truncated: boolean;
    };
    nodes: JourneyNode[];
  };
  /** Present only when something limits how far the tree can be trusted. */
  notes?: string[];
}

export interface JourneySummary {
  format: "summary";
  window: { from: string; to: string };
  app: string;
  rootN: number;
  coverage: {
    sessionsWithEvents: number;
    /** Null when the recordings read failed: unknown, never zero. */
    sessionsWithReplay: number | null;
    truncated: boolean;
  };
  /** One line per node, indented by depth. */
  outline: string;
  followUp: JourneyFollowup;
  standaloneSetup?: {
    rootN: number;
    coverage: {
      sessionsWithEvents: number;
      sessionsWithReplay: number | null;
      truncated: boolean;
    };
    outline: string;
  };
  notes?: string[];
}

export interface JourneyFollowup {
  status: "complete" | "incomplete";
  incompleteReason?:
    | "journey_event_read_truncated"
    | "journey_event_read_invalid"
    | "journey_event_read_may_have_shifted"
    | "terminal_cohort_query_too_large"
    | "followup_aggregate_truncated"
    | "followup_aggregate_invalid"
    | "terminal_cohort_mismatch";
  observationCutoff: string;
  observationFollowupDurationMs: {
    min: number;
    max: number;
    mean: number;
  } | null;
  rightCensoredAtWindowEnd: true;
  coverage: {
    journeyEventRead: {
      rows: number;
      pages: number;
      truncated: boolean;
      paginationConsistency: "stable" | "may_have_shifted";
    };
    followupAggregateRead: {
      rows: number | null;
      queries: number;
      truncated: boolean;
    };
    cohortSessions: number | null;
  };
  laterRecordedActivityWithinWindow: {
    total: number | null;
    byTerminalStepKey: Record<string, number> | null;
  };
  noLaterRecordedActivityWithinWindow: {
    total: number | null;
    byTerminalStepKey: Record<string, number> | null;
  };
}

/** Recordings could not be read completely, so examples would misreport replay availability. */
export class JourneyRecordingsError extends Error {}

export function parseJourneyTimestampMs(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === "object" && "value" in value) {
    return parseJourneyTimestampMs((value as { value: unknown }).value);
  }
  if (typeof value !== "string") return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  // BigQuery text casts: "2026-10-07 12:00:00.123+00".
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const normalized = Date.parse(iso);
  return Number.isNaN(normalized) ? null : normalized;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function integer(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseJourneyEventRow(
  raw: Record<string, unknown>,
): JourneyEventRow | null {
  const id = text(raw.id);
  const sessionId = text(raw.session_id);
  const eventName = text(raw.event_name);
  const journeyKind = text(raw.journey_kind);
  const tsMs = parseJourneyTimestampMs(raw.timestamp);
  if (
    !id ||
    !sessionId ||
    !eventName ||
    (journeyKind !== "onboarding" && journeyKind !== "standalone_setup") ||
    tsMs === null
  ) {
    return null;
  }
  return {
    id,
    sessionId,
    journeyKind,
    tsMs,
    eventName,
    templateName: text(raw.template_name),
    path: text(raw.path),
    flow: text(raw.flow),
    source: text(raw.source),
    stepId: text(raw.step_id),
    stepIndex: integer(raw.step_index),
    methodId: text(raw.method_id),
    outcome: text(raw.outcome),
    action: text(raw.action),
    aliasId: text(raw.alias_id),
    attemptId: text(raw.attempt_id),
  };
}

interface EventRead {
  rows: JourneyEventRow[];
  rawRows: number;
  invalidRows: number;
  truncated: boolean;
  onboardingTruncated: boolean;
  standaloneSetupTruncated: boolean;
  lastSessionDroppedFor: JourneyEventRow["journeyKind"] | null;
  pages: number;
  paginationConsistency: "stable" | "may_have_shifted";
}

async function readJourneyEvents(
  scope: AnalyticsScope,
  filters: OnboardingJourneyEventsFilters,
  maxEventRows: number,
  observation: OnboardingJourneyObservationWindow,
): Promise<EventRead> {
  const raw: Record<string, unknown>[] = [];
  let truncated = false;
  let truncatedAt: JourneyEventRow["journeyKind"] | null = null;
  let overflowSessionId: string | null = null;
  let pages = 0;
  let rowsFetched = 0;
  for (;;) {
    // One row past the budget tells a full read from a cut one.
    const limit = Math.min(EVENT_PAGE_ROWS, maxEventRows + 1 - raw.length);
    const page = await queryFirstPartyAnalytics(
      buildOnboardingJourneyEventsSql(
        filters,
        {
          limit,
          offset: raw.length,
        },
        observation,
      ),
      scope,
      { cache: true },
    );
    pages += 1;
    raw.push(...page.rows);
    rowsFetched += page.rows.length;
    if (page.truncated) {
      truncated = true;
      break;
    }
    if (page.rows.length < limit) break;
    if (raw.length > maxEventRows) {
      truncated = true;
      const overflowKind = raw[maxEventRows]?.journey_kind;
      truncatedAt =
        overflowKind === "onboarding" || overflowKind === "standalone_setup"
          ? overflowKind
          : null;
      overflowSessionId = text(raw[maxEventRows]?.session_id);
      raw.length = maxEventRows;
      break;
    }
  }

  const byId = new Map<string, JourneyEventRow>();
  let invalidRows = 0;
  for (const record of raw) {
    const row = parseJourneyEventRow(record);
    if (!row) invalidRows += 1;
    else byId.set(row.id, row);
  }
  let rows = [...byId.values()];
  let lastSessionDroppedFor: JourneyEventRow["journeyKind"] | null = null;
  if (truncated) {
    const lastIncluded = raw[raw.length - 1];
    const lastSession = text(lastIncluded?.session_id);
    const lastKind = lastIncluded?.journey_kind;
    const knownLastKind =
      lastKind === "onboarding" || lastKind === "standalone_setup"
        ? lastKind
        : null;
    const cutWithinLastSession =
      truncatedAt !== null &&
      truncatedAt === knownLastKind &&
      overflowSessionId !== null &&
      overflowSessionId === lastSession;
    if (lastSession && (truncatedAt === null || cutWithinLastSession)) {
      rows = rows.filter(
        (row) =>
          (knownLastKind !== null && row.journeyKind !== knownLastKind) ||
          row.sessionId !== lastSession,
      );
      lastSessionDroppedFor = knownLastKind;
    }
  }
  return {
    rows,
    rawRows: rowsFetched,
    invalidRows,
    truncated,
    onboardingTruncated: truncated && truncatedAt !== "standalone_setup",
    standaloneSetupTruncated: truncated,
    lastSessionDroppedFor,
    pages,
    paginationConsistency: pages > 1 ? "may_have_shifted" : "stable",
  };
}

function groupSessions(rows: readonly JourneyEventRow[]): {
  sessions: JourneySession[];
  terminalSteps: OnboardingJourneyTerminalStep[];
  sessionsWithoutSteps: number;
} {
  const bySession = new Map<string, JourneyEventRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.sessionId);
    if (list) list.push(row);
    else bySession.set(row.sessionId, [row]);
  }
  const sessions: JourneySession[] = [];
  const terminalSteps: OnboardingJourneyTerminalStep[] = [];
  let sessionsWithoutSteps = 0;
  for (const [sessionId, sessionRows] of bySession) {
    const selected = projectSessionSteps(sessionRows);
    const steps: JourneyStep[] = selected.map(({ key, label, tsMs }) => ({
      key,
      label,
      tsMs,
    }));
    const terminal = selected[selected.length - 1];
    if (steps.length && terminal) {
      sessions.push({ sessionId, steps });
      terminalSteps.push({
        sessionId,
        stepKey: terminal.key,
        tsMs: terminal.tsMs,
      });
    } else sessionsWithoutSteps += 1;
  }
  sessions.sort((a, b) =>
    a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  );
  terminalSteps.sort((a, b) =>
    a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  );
  return {
    sessions,
    terminalSteps,
    sessionsWithoutSteps,
  };
}

function freezeObservationWindow(
  args: OnboardingJourneyEventsFilters,
): OnboardingJourneyObservationWindow {
  const requestedAtMs = Date.now();
  const requestedEndExclusive = Date.parse(`${args.dateTo}T00:00:00Z`) + DAY_MS;
  const cutoffMs = Math.min(requestedAtMs, requestedEndExclusive);
  const observationCutoff = new Date(cutoffMs).toISOString();
  return {
    observationCutoff,
    observationDate: observationCutoff.slice(0, 10),
  };
}

function incompleteFollowup(
  observation: OnboardingJourneyObservationWindow,
  read: EventRead,
  reason: NonNullable<JourneyFollowup["incompleteReason"]>,
  options: {
    rows?: number | null;
    queries?: number;
    truncated?: boolean;
  } = {},
): JourneyFollowup {
  return {
    status: "incomplete",
    incompleteReason: reason,
    observationCutoff: observation.observationCutoff,
    observationFollowupDurationMs: null,
    rightCensoredAtWindowEnd: true,
    coverage: {
      journeyEventRead: {
        rows: read.rawRows,
        pages: read.pages,
        truncated: read.truncated,
        paginationConsistency: read.paginationConsistency,
      },
      followupAggregateRead: {
        rows: options.rows ?? null,
        queries: options.queries ?? 0,
        truncated: options.truncated ?? false,
      },
      cohortSessions: null,
    },
    laterRecordedActivityWithinWindow: { total: null, byTerminalStepKey: null },
    noLaterRecordedActivityWithinWindow: {
      total: null,
      byTerminalStepKey: null,
    },
  };
}

async function readFollowup(
  scope: AnalyticsScope,
  filters: OnboardingJourneyEventsFilters,
  read: EventRead,
  terminals: readonly OnboardingJourneyTerminalStep[],
  observation: OnboardingJourneyObservationWindow,
): Promise<JourneyFollowup> {
  if (
    read.truncated ||
    read.invalidRows ||
    read.paginationConsistency === "may_have_shifted"
  ) {
    const reason = read.truncated
      ? "journey_event_read_truncated"
      : read.invalidRows
        ? "journey_event_read_invalid"
        : "journey_event_read_may_have_shifted";
    return incompleteFollowup(observation, read, reason);
  }
  if (terminals.length === 0) {
    return {
      status: "complete",
      observationCutoff: observation.observationCutoff,
      observationFollowupDurationMs: null,
      rightCensoredAtWindowEnd: true,
      coverage: {
        journeyEventRead: {
          rows: read.rawRows,
          pages: read.pages,
          truncated: read.truncated,
          paginationConsistency: read.paginationConsistency,
        },
        followupAggregateRead: { rows: 0, queries: 0, truncated: false },
        cohortSessions: 0,
      },
      laterRecordedActivityWithinWindow: {
        total: 0,
        byTerminalStepKey: {},
      },
      noLaterRecordedActivityWithinWindow: {
        total: 0,
        byTerminalStepKey: {},
      },
    };
  }
  const sql = buildOnboardingJourneyFollowupSql(
    filters,
    terminals,
    observation,
  );
  if (
    sql.length > MAX_FOLLOWUP_QUERY_CHARS ||
    lexAgentSql(sql, { dialect: "postgres" }).length > MAX_FOLLOWUP_QUERY_TOKENS
  ) {
    return incompleteFollowup(
      observation,
      read,
      "terminal_cohort_query_too_large",
    );
  }
  const result = await queryFirstPartyAnalytics(sql, scope, { cache: true });
  if (result.truncated) {
    return incompleteFollowup(
      observation,
      read,
      "followup_aggregate_truncated",
      {
        queries: 1,
        truncated: true,
      },
    );
  }
  const aggregateRows = result.rows.length;
  const cohortByStep = new Map<string, number>();
  const laterByStep = new Map<string, number>();
  for (const row of result.rows) {
    const stepKey = text(row.terminal_step_key);
    const cohortSessions = integer(row.cohort_sessions);
    const laterSessions = integer(row.later_recorded_activity);
    if (
      !stepKey ||
      cohortSessions === null ||
      laterSessions === null ||
      cohortSessions < 0 ||
      laterSessions < 0 ||
      laterSessions > cohortSessions ||
      cohortByStep.has(stepKey)
    ) {
      return incompleteFollowup(
        observation,
        read,
        "followup_aggregate_invalid",
        {
          rows: aggregateRows,
          queries: 1,
        },
      );
    }
    cohortByStep.set(stepKey, cohortSessions);
    laterByStep.set(stepKey, laterSessions);
  }

  const expectedByStep = new Map<string, number>();
  for (const terminal of terminals) {
    expectedByStep.set(
      terminal.stepKey,
      (expectedByStep.get(terminal.stepKey) ?? 0) + 1,
    );
  }
  if (
    [...expectedByStep].some(
      ([stepKey, count]) => cohortByStep.get(stepKey) !== count,
    ) ||
    cohortByStep.size !== expectedByStep.size
  ) {
    return incompleteFollowup(observation, read, "terminal_cohort_mismatch", {
      rows: aggregateRows,
      queries: 1,
    });
  }

  const noLaterByStep: Record<string, number> = {};
  const laterByStepObject: Record<string, number> = {};
  for (const [stepKey, count] of [...expectedByStep].sort(([a], [b]) =>
    compareKeys(a, b),
  )) {
    const laterCount = laterByStep.get(stepKey) ?? 0;
    laterByStepObject[stepKey] = laterCount;
    noLaterByStep[stepKey] = count - laterCount;
  }
  const total = terminals.length;
  const laterTotal = Object.values(laterByStepObject).reduce(
    (sum, count) => sum + count,
    0,
  );
  const durationMs = terminals.map(
    (terminal) => Date.parse(observation.observationCutoff) - terminal.tsMs,
  );
  const followupDuration = durationMs.length
    ? durationMs.reduce(
        (summary, duration) => ({
          min: Math.min(summary.min, duration),
          max: Math.max(summary.max, duration),
          total: summary.total + duration,
        }),
        {
          min: Number.POSITIVE_INFINITY,
          max: Number.NEGATIVE_INFINITY,
          total: 0,
        },
      )
    : null;
  const durationSummary = followupDuration
    ? {
        min: followupDuration.min,
        max: followupDuration.max,
        mean: Math.round(followupDuration.total / durationMs.length),
      }
    : null;
  return {
    status: "complete",
    observationCutoff: observation.observationCutoff,
    observationFollowupDurationMs: durationSummary,
    rightCensoredAtWindowEnd: true,
    coverage: {
      journeyEventRead: {
        rows: read.rawRows,
        pages: read.pages,
        truncated: read.truncated,
        paginationConsistency: read.paginationConsistency,
      },
      followupAggregateRead: {
        rows: aggregateRows,
        queries: 1,
        truncated: false,
      },
      cohortSessions: total,
    },
    laterRecordedActivityWithinWindow: {
      total: laterTotal,
      byTerminalStepKey: laterByStepObject,
    },
    noLaterRecordedActivityWithinWindow: {
      total: total - laterTotal,
      byTerminalStepKey: noLaterByStep,
    },
  };
}

async function readRecordings(
  scope: AnalyticsScope,
  sessionIds: readonly string[],
  args: OnboardingJourneyArgs,
): Promise<JourneyRecording[]> {
  if (!sessionIds.length) return [];
  // A recording can start the day before a late-night session's first event.
  const fromIso = new Date(
    Date.parse(`${args.dateFrom}T00:00:00Z`) - DAY_MS,
  ).toISOString();
  const toIso = new Date(
    Date.parse(`${args.dateTo}T00:00:00Z`) + 2 * DAY_MS,
  ).toISOString();
  let read;
  try {
    read = await listJourneyRecordings(scope, sessionIds, { fromIso, toIso });
  } catch (error) {
    // The cause can quote database details, so the server log keeps it.
    console.error("[onboarding-journey] recordings read failed", error);
    throw new JourneyRecordingsError("Session recordings could not be read.");
  }
  if (!read.complete) {
    throw new JourneyRecordingsError(
      "Session recordings were read incompletely, so replay availability is unknown.",
    );
  }
  return read.recordings;
}

function replayUrlBuilder():
  | ((recordingId: string, offsetMs: number) => string)
  | undefined {
  const origin = getRequestContext()?.requestOrigin;
  if (!origin || !URL.canParse(origin)) return undefined;
  const prefix = `${new URL(origin).origin}${getAppBasePath()}`;
  return (recordingId, offsetMs) =>
    `${prefix}/sessions/${encodeURIComponent(recordingId)}?atMs=${offsetMs}`;
}

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Keep the `maxNodes` largest nodes. A child never has more sessions than its
 * parent and ties break toward the shallower node, so what stays is still a
 * tree rooted at the first steps.
 */
function capNodes(
  nodes: JourneyNode[],
  maxNodes: number,
): { nodes: JourneyNode[]; dropped: number } {
  if (nodes.length <= maxNodes) return { nodes, dropped: 0 };
  const keep = new Set(
    [...nodes]
      .sort(
        (a, b) => b.n - a.n || a.depth - b.depth || compareKeys(a.key, b.key),
      )
      .slice(0, maxNodes)
      .map((node) => node.key),
  );
  return {
    nodes: addDeeperCounts(nodes.filter((node) => keep.has(node.key))),
    dropped: nodes.length - maxNodes,
  };
}

/**
 * One line per node, indented by depth. A node at `maxDepth` that more
 * sessions passed through than ended or branched there says how many carried
 * on, since the tree stops tracking them.
 */
export function formatJourneyOutline(
  nodes: readonly JourneyNode[],
  maxDepth: number,
): string {
  return nodes
    .map((node) => {
      const tail =
        node.deeperN === 0
          ? ""
          : node.depth === maxDepth
            ? `, ${node.deeperN} continue past depth ${maxDepth}`
            : `, deeperN=${node.deeperN} continue below this node`;
      return `${"  ".repeat(node.depth - 1)}${node.label} - n=${node.n} (${node.pctOfRoot}% of all, ${node.pctOfParent}% of parent), dropoff ${node.dropoffN} (${node.dropoffPct}%)${tail}`;
    })
    .join("\n");
}

export async function getOnboardingJourney(
  scope: AnalyticsScope,
  args: OnboardingJourneyArgs,
): Promise<JourneyTree | JourneySummary> {
  const observation = freezeObservationWindow(args);
  const read = await readJourneyEvents(
    scope,
    args,
    args.maxEventRows,
    observation,
  );
  const { sessions, terminalSteps, sessionsWithoutSteps } = groupSessions(
    read.rows.filter((row) => row.journeyKind === "onboarding"),
  );
  const standalone = groupSessions(
    read.rows.filter((row) => row.journeyKind === "standalone_setup"),
  );
  const followUp = await readFollowup(
    scope,
    args,
    read,
    terminalSteps,
    observation,
  );
  const sessionIds = [
    ...new Set([
      ...sessions.map((session) => session.sessionId),
      ...standalone.sessions.map((session) => session.sessionId),
    ]),
  ];
  const depthTruncated = sessions.some(
    (session) => session.steps.length > args.maxDepth,
  );
  const standaloneDepthTruncated = standalone.sessions.some(
    (session) => session.steps.length > args.maxDepth,
  );

  let recordings: JourneyRecording[] | null;
  try {
    recordings = await readRecordings(scope, sessionIds, args);
  } catch (error) {
    // A summary carries no examples, so it reports the count as unknown;
    // a tree whose examples would be wrong fails instead.
    if (args.format === "tree" || !(error instanceof JourneyRecordingsError)) {
      throw error;
    }
    recordings = null;
  }
  const bySession = new Map<string, JourneyRecording[]>();
  for (const recording of recordings ?? []) {
    const list = bySession.get(recording.sessionId);
    if (list) list.push(recording);
    else bySession.set(recording.sessionId, [recording]);
  }

  const built = buildJourneyTree(sessions, bySession, {
    maxDepth: args.maxDepth,
    minNodeSessions: args.minNodeSessions,
    examplesPerNode: args.format === "tree" ? args.examplesPerNode : 0,
    settleMs: args.settleMs,
    recency: args.recency,
    viewport: args.viewport,
    replayUrlFor: replayUrlBuilder(),
  });
  const capped = capNodes(built.nodes, args.maxNodes);
  const hasStandaloneResult =
    standalone.sessions.length > 0 || read.standaloneSetupTruncated;
  const standaloneBuilt = hasStandaloneResult
    ? buildJourneyTree(standalone.sessions, bySession, {
        maxDepth: args.maxDepth,
        minNodeSessions: args.minNodeSessions,
        examplesPerNode: args.format === "tree" ? args.examplesPerNode : 0,
        settleMs: args.settleMs,
        recency: args.recency,
        viewport: args.viewport,
        replayUrlFor: replayUrlBuilder(),
      })
    : null;
  const standaloneCapped = standaloneBuilt
    ? capNodes(standaloneBuilt.nodes, args.maxNodes)
    : null;

  const notes: string[] = [];
  if (read.onboardingTruncated) {
    notes.push(
      `Event read stopped at maxEventRows=${args.maxEventRows} while reading onboarding events; onboarding counts are a partial sample${read.lastSessionDroppedFor === "onboarding" ? " and the last onboarding session read was left out" : ""}.`,
    );
  }
  if (read.standaloneSetupTruncated) {
    notes.push(
      `The event read reached maxEventRows=${args.maxEventRows}; standalone setup results may be incomplete or absent${read.lastSessionDroppedFor === "standalone_setup" ? ", and the last standalone setup session read was left out" : ""}.`,
    );
  }
  if (depthTruncated || standaloneDepthTruncated) {
    notes.push(
      `Some onboarding or standalone setup sessions continue beyond maxDepth=${args.maxDepth}; deeperN counts observed continuation omitted below each returned node.`,
    );
  }
  if (read.pages > 1) {
    // Late-arriving events can change OFFSET page membership in any window.
    notes.push(
      `The event read took ${read.pages} OFFSET pages; late-arriving events can shift page membership in any window, so returned tree counts may be incomplete.`,
    );
  }
  if (capped.dropped) {
    notes.push(
      `Node list cut to the ${args.maxNodes} largest of ${built.nodes.length}; children counts no longer sum to their parents.`,
    );
  }
  if (standaloneCapped?.dropped) {
    notes.push(
      `Standalone setup tree cut to the ${args.maxNodes} largest of ${standaloneBuilt!.nodes.length} nodes.`,
    );
  }
  if (read.invalidRows) {
    notes.push(
      `${read.invalidRows} event rows had no id, session, or readable timestamp and were not counted.`,
    );
  }
  if (sessionsWithoutSteps + standalone.sessionsWithoutSteps) {
    notes.push(
      `${sessionsWithoutSteps + standalone.sessionsWithoutSteps} sessions had events but no step with a meaning (for example a pageview without a path) and are not in a tree.`,
    );
  }
  const head = {
    window: { from: args.dateFrom, to: args.dateTo },
    app: args.app,
    rootN: built.rootN,
    ...(notes.length ? { notes } : {}),
  };
  const truncated =
    read.onboardingTruncated || depthTruncated || capped.dropped > 0;
  if (args.format === "summary") {
    return {
      format: "summary",
      ...head,
      coverage: {
        sessionsWithEvents: sessions.length,
        sessionsWithReplay:
          recordings === null
            ? null
            : sessions.filter((session) => bySession.has(session.sessionId))
                .length,
        truncated,
      },
      outline: formatJourneyOutline(capped.nodes, args.maxDepth),
      followUp,
      ...(standaloneBuilt && standaloneCapped
        ? {
            standaloneSetup: {
              rootN: standaloneBuilt.rootN,
              coverage: {
                sessionsWithEvents: standalone.sessions.length,
                sessionsWithReplay:
                  recordings === null
                    ? null
                    : standalone.sessions.filter((session) =>
                        bySession.has(session.sessionId),
                      ).length,
                truncated:
                  read.standaloneSetupTruncated ||
                  standaloneDepthTruncated ||
                  standaloneCapped.dropped > 0,
              },
              outline: formatJourneyOutline(
                standaloneCapped.nodes,
                args.maxDepth,
              ),
            },
          }
        : {}),
    };
  }
  return {
    ...head,
    coverage: {
      sessionsWithEvents: sessions.length,
      sessionsWithReplay: sessions.filter((session) =>
        bySession.has(session.sessionId),
      ).length,
      truncated,
    },
    nodes: capped.nodes,
    followUp,
    ...(standaloneBuilt && standaloneCapped
      ? {
          standaloneSetup: {
            rootN: standaloneBuilt.rootN,
            coverage: {
              sessionsWithEvents: standalone.sessions.length,
              sessionsWithReplay: standalone.sessions.filter((session) =>
                bySession.has(session.sessionId),
              ).length,
              truncated:
                read.standaloneSetupTruncated ||
                standaloneDepthTruncated ||
                standaloneCapped.dropped > 0,
            },
            nodes: standaloneCapped.nodes,
          },
        }
      : {}),
  };
}
