import { getAppBasePath, getRequestContext } from "@agent-native/core/server";

import {
  queryFirstPartyAnalytics,
  type AnalyticsScope,
} from "./first-party-analytics.js";
import {
  buildOnboardingJourneyEventsSql,
  type OnboardingJourneyEventsFilters,
} from "./first-party-metric-catalog.js";
import { buildSessionSteps, type JourneyEventRow } from "./journey-steps.js";
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
    path: text(raw.path),
    flow: text(raw.flow),
    source: text(raw.source),
    stepId: text(raw.step_id),
    stepIndex: integer(raw.step_index),
    methodId: text(raw.method_id),
    outcome: text(raw.outcome),
    action: text(raw.action),
  };
}

interface EventRead {
  rows: JourneyEventRow[];
  invalidRows: number;
  truncated: boolean;
  onboardingTruncated: boolean;
  standaloneSetupTruncated: boolean;
  lastSessionDroppedFor: JourneyEventRow["journeyKind"] | null;
  pages: number;
}

async function readJourneyEvents(
  scope: AnalyticsScope,
  filters: OnboardingJourneyEventsFilters,
  maxEventRows: number,
): Promise<EventRead> {
  const raw: Record<string, unknown>[] = [];
  let truncated = false;
  let truncatedAt: JourneyEventRow["journeyKind"] | null = null;
  let overflowSessionId: string | null = null;
  let pages = 0;
  for (;;) {
    // One row past the budget tells a full read from a cut one.
    const limit = Math.min(EVENT_PAGE_ROWS, maxEventRows + 1 - raw.length);
    const page = await queryFirstPartyAnalytics(
      buildOnboardingJourneyEventsSql(filters, {
        limit,
        offset: raw.length,
      }),
      scope,
      { cache: true },
    );
    if (page.truncated) {
      throw new Error("Journey event page exceeded the query row cap");
    }
    pages += 1;
    raw.push(...page.rows);
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
    invalidRows,
    truncated,
    onboardingTruncated: truncated && truncatedAt !== "standalone_setup",
    standaloneSetupTruncated: truncated,
    lastSessionDroppedFor,
    pages,
  };
}

function groupSessions(rows: readonly JourneyEventRow[]): {
  sessions: JourneySession[];
  sessionsWithoutSteps: number;
} {
  const bySession = new Map<string, JourneyEventRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.sessionId);
    if (list) list.push(row);
    else bySession.set(row.sessionId, [row]);
  }
  const sessions: JourneySession[] = [];
  let sessionsWithoutSteps = 0;
  for (const [sessionId, sessionRows] of bySession) {
    const steps = buildSessionSteps(sessionRows);
    if (steps.length) sessions.push({ sessionId, steps });
    else sessionsWithoutSteps += 1;
  }
  sessions.sort((a, b) =>
    a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0,
  );
  return { sessions, sessionsWithoutSteps };
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
  const read = await readJourneyEvents(scope, args, args.maxEventRows);
  const { sessions, sessionsWithoutSteps } = groupSessions(
    read.rows.filter((row) => row.journeyKind === "onboarding"),
  );
  const standalone = groupSessions(
    read.rows.filter((row) => row.journeyKind === "standalone_setup"),
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
  if (read.pages > 1 && args.dateTo >= new Date().toISOString().slice(0, 10)) {
    // Pages are OFFSET reads of a table that is still receiving events.
    notes.push(
      `The window includes today and the read took ${read.pages} pages; events that arrived while it ran can shift page boundaries, so a few rows near the live edge may be missing.`,
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
