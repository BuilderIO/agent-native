import type { AuditEvent } from "@agent-native/core/audit";

import { WorkflowStoreError, type WorkflowScope } from "../workflow/adapter.js";
import { SCHEDULE_STARTER, type RunTriggerKind } from "../workflow/contract.js";
import {
  READ_LIMITS,
  WorkflowReadError,
  clipText,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityPosition,
  type RunView,
  type WorkflowReadModels,
} from "./read-models.js";

/** The audit target type the workflow actions record changes under. */
const WORKFLOW_AUDIT_TARGET_TYPE = "factory-workflow";

/** Audit rows read for one page before it gives up filling the page and says there is more. */
const AUDIT_SCAN_ROWS = 500;
const AUDIT_SCAN_PAGE = 100;

type ActivityKind = "run" | "change" | "needs_you";
type ActivityWho = "person" | "agent" | "schedule";

interface ActivityActor {
  /**
   * A run is the `schedule`'s, or a `person`'s: the email on a run is whoever
   * started it, and a run does not say whether that was by hand or by the
   * agent for them. `service` is a service principal, for a change.
   */
  kind: "person" | "agent" | "service" | "schedule";
  email: string | null;
}

export type ActivityLink =
  | { type: "run"; workflowId: string; runId: string }
  | { type: "version"; workflowId: string; version: number | null }
  | { type: "item"; workflowId: string; itemId: string };

interface EntryBase {
  /** Stable and unique; also the tie-break between entries at one instant. */
  id: string;
  at: string;
  workflowId: string;
  workflowName: string | null;
  actor: ActivityActor;
  link: ActivityLink;
}

type ChangeKind =
  | "created"
  | "saved"
  | "enabled"
  | "disabled"
  | "restored"
  | "deleted"
  | "other";

export interface RunActivity extends EntryBase {
  kind: "run";
  status: RunView["status"];
  mode: RunView["mode"];
  triggerKind: RunTriggerKind;
  counts: RunView["counts"];
  error: RunView["error"];
}

export interface ChangeActivity extends EntryBase {
  kind: "change";
  change: ChangeKind;
  /** The version the change names; null when the audit row does not carry one (enable, disable, delete). */
  version: number | null;
  /** The audit action that recorded it, such as `save-factory-workflow`. */
  action: string;
  summary: string | null;
}

export interface NeedsYouActivity extends EntryBase {
  kind: "needs_you";
  item: {
    id: string;
    inbox: boolean;
    title: string | null;
    source: string | null;
    status: string | null;
  };
  nodeId: string | null;
  reason: string;
  reasonTruncated: boolean;
}

export type ActivityEntry = RunActivity | ChangeActivity | NeedsYouActivity;

interface ActivityPage {
  entries: ActivityEntry[];
  /** A page can be short while this is true: the audit scan reached its bound. Ask again with the cursor. */
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ActivityInput {
  workflowId?: string;
  who?: ActivityWho;
  kind?: ActivityKind;
  /** Inclusive. */
  since?: string;
  /** Exclusive. */
  until?: string;
  limit?: number;
  cursor?: string;
}

/** What the feed asks of the framework audit reader (`queryAuditEventPage`). */
export interface AuditPageQuery {
  targetType: string;
  targetId?: string;
  actorKind?: "agent" | "human" | "system";
  status: "success";
  sinceMs?: number;
  beforeMs?: number;
  limit: number;
  offset: number;
}

interface AuditPage {
  events: AuditEvent[];
  hasMore: boolean;
  nextOffset: number | null;
}

type AuditPageReader = (query: AuditPageQuery) => Promise<AuditPage>;

/** One audit row with its recorded input, which a page of rows does not carry (`getAuditEventById`). */
type AuditEventReader = (id: string) => Promise<AuditEvent | null>;

export interface ActivityFeed {
  list(scope: WorkflowScope, input: ActivityInput): Promise<ActivityPage>;
}

const WHO_AUDIT_ACTOR_KIND = {
  person: "human",
  agent: "agent",
  schedule: "system",
} as const;

const AUDIT_ACTOR: Record<AuditEvent["actorKind"], ActivityActor["kind"]> = {
  human: "person",
  agent: "agent",
  service: "service",
  system: "schedule",
};

function parseInstant(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new WorkflowReadError(
      "invalid_input",
      `${label} is not a date-time.`,
      {
        value,
      },
    );
  }
  return ms;
}

/**
 * The workflow actions' audit rows: the action name says the change, and the
 * summary says which way an enable switch went and which version a save made.
 * A page of audit rows carries no recorded input, so nothing is read from it.
 */
function changeKindOf(event: AuditEvent): ChangeKind {
  switch (event.action) {
    case "save-factory-workflow":
      return event.summary?.startsWith("Created") ? "created" : "saved";
    case "restore-factory-workflow-version":
      return "restored";
    case "delete-factory-workflow":
      return "deleted";
    case "set-factory-workflow-enabled":
      if (event.summary?.startsWith("Enabled")) return "enabled";
      if (event.summary?.startsWith("Disabled")) return "disabled";
      return "other";
    default:
      return "other";
  }
}

function factoryOfInput(input: string | null): string | null {
  if (input === null) return null;
  try {
    const parsed: unknown = JSON.parse(input);
    const factoryId = (parsed as { factoryId?: unknown } | null)?.factoryId;
    return typeof factoryId === "string" ? factoryId : null;
  } catch {
    // coercion-ok: an unreadable input cannot show the row is ours, so the row stays out
    return null;
  }
}

function versionOf(summary: string | null): number | null {
  const match = summary?.match(/\bas version (\d+)\b/);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function newestFirst(
  a: { atMs: number; id: string },
  b: { atMs: number; id: string },
) {
  if (a.atMs !== b.atMs) return b.atMs - a.atMs;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

interface SourceResult {
  entries: (ActivityEntry & { atMs: number })[];
  /**
   * Set when the source stopped before it was sure it had every entry newer
   * than this instant's page: nothing older than it may be returned yet.
   */
  floorMs: number | null;
}

/**
 * The Activity feed: runs, changes, and hand-offs to a person, merged by time
 * into one page behind one cursor.
 *
 * Runs and hand-offs come from the workflow tables. Changes come from the
 * framework audit log through its exported reader (`queryAuditEventPage`),
 * which pages by offset and filters by one target at a time; the factory a
 * change belongs to is therefore decided here, by looking the target workflow
 * up in this scope. The cursor is the instant of the last entry plus the ids
 * already returned at that instant, which keeps all three sources in step
 * whatever order each one orders ties in.
 */
export function createActivityFeed(deps: {
  readModels: WorkflowReadModels;
  readAudit: AuditPageReader;
  readAuditEvent: AuditEventReader;
}): ActivityFeed {
  const { readModels, readAudit, readAuditEvent } = deps;

  async function auditChanges(
    scope: WorkflowScope,
    input: ActivityInput,
    want: number,
    position: ActivityPosition | undefined,
    sinceMs: number | undefined,
    untilMs: number | undefined,
  ): Promise<SourceResult> {
    const beforeMs =
      position === undefined
        ? untilMs
        : Math.min(untilMs ?? Infinity, position.atMs + 1);
    const seen = new Set(
      (position?.seen ?? [])
        .filter((key) => key.startsWith("change:"))
        .map((key) => key.slice("change:".length)),
    );
    const entries: SourceResult["entries"] = [];
    let offset = 0;
    let scanned = 0;
    let floorMs: number | null = null;
    for (;;) {
      const page = await readAudit({
        targetType: WORKFLOW_AUDIT_TARGET_TYPE,
        ...(input.workflowId === undefined
          ? {}
          : { targetId: input.workflowId }),
        ...(input.who === undefined
          ? {}
          : { actorKind: WHO_AUDIT_ACTOR_KIND[input.who] }),
        status: "success",
        ...(sinceMs === undefined ? {} : { sinceMs }),
        ...(beforeMs === undefined ? {} : { beforeMs }),
        limit: AUDIT_SCAN_PAGE,
        offset,
      });
      scanned += page.events.length;
      const names = await readModels.workflowNames(
        scope,
        page.events.flatMap((event) =>
          event.targetId === null ? [] : [event.targetId],
        ),
      );
      for (const event of page.events) {
        if (event.orgId !== scope.orgId || event.targetId === null) continue;
        if (
          position !== undefined &&
          event.createdAt === position.atMs &&
          seen.has(event.id)
        ) {
          continue;
        }
        const name = names.get(event.targetId);
        // A deleted workflow is gone from this scope, so its delete row proves
        // its factory through the input the action recorded, which only the
        // one-row read returns. A row the retention purge has removed since
        // proves nothing, and stays out.
        let ours = name !== undefined;
        if (!ours && event.action === "delete-factory-workflow") {
          const recorded = await readAuditEvent(event.id);
          ours =
            recorded !== null &&
            factoryOfInput(recorded.input) === scope.factoryId;
        }
        if (!ours) continue;
        const summary =
          event.summary === null
            ? null
            : clipText(event.summary, READ_LIMITS.shortSummaryChars).text;
        const change = changeKindOf(event);
        const version = versionOf(event.summary);
        entries.push({
          kind: "change",
          id: `change:${event.id}`,
          atMs: event.createdAt,
          at: new Date(event.createdAt).toISOString(),
          workflowId: event.targetId,
          workflowName: name ?? null,
          actor: {
            kind: AUDIT_ACTOR[event.actorKind],
            email: event.actorEmail,
          },
          link: {
            type: "version",
            workflowId: event.targetId,
            version,
          },
          change,
          version,
          action: event.action,
          summary,
        });
      }
      if (entries.length >= want || !page.hasMore || page.nextOffset === null) {
        break;
      }
      if (scanned >= AUDIT_SCAN_ROWS) {
        const last = page.events[page.events.length - 1];
        floorMs = last === undefined ? null : last.createdAt;
        break;
      }
      offset = page.nextOffset;
    }
    return { entries, floorMs };
  }

  return {
    async list(scope, input) {
      const limit =
        input.limit === undefined ? READ_LIMITS.pageDefault : input.limit;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > READ_LIMITS.pageMax
      ) {
        throw new WorkflowReadError(
          "invalid_input",
          `Activity limit must be a whole number from 1 to ${READ_LIMITS.pageMax}.`,
          { limit },
        );
      }
      const position =
        input.cursor === undefined
          ? undefined
          : decodeActivityCursor(input.cursor);
      const sinceMs = parseInstant(input.since, "since");
      const untilMs = parseInstant(input.until, "until");
      if (input.workflowId !== undefined) {
        const names = await readModels.workflowNames(scope, [input.workflowId]);
        if (!names.has(input.workflowId)) {
          throw new WorkflowReadError(
            "workflow_not_found",
            `Workflow "${input.workflowId}" was not found in this factory.`,
            { workflowId: input.workflowId },
          );
        }
      }

      const wantKind = (kind: ActivityKind) =>
        input.kind === undefined || input.kind === kind;
      // A run or a hand-off belongs to the schedule or to the person who
      // started the run. None is the agent's: a run records an email, not a kind.
      const noRunSources = input.who === "agent";
      const query = {
        ...(input.workflowId === undefined
          ? {}
          : { workflowId: input.workflowId }),
        ...(input.since === undefined ? {} : { since: input.since }),
        ...(input.until === undefined ? {} : { until: input.until }),
        ...(position === undefined ? {} : { after: position }),
        ...(input.who === "schedule"
          ? { starter: "schedule" as const }
          : input.who === "person"
            ? { starter: "person" as const }
            : {}),
        limit: limit + 1,
      };

      const [runRows, needsRows, changes] = await Promise.all([
        wantKind("run") && !noRunSources
          ? readModels.activityRuns(scope, query)
          : [],
        wantKind("needs_you") && !noRunSources
          ? readModels.activityNeedsYou(scope, query)
          : [],
        wantKind("change")
          ? auditChanges(scope, input, limit + 1, position, sinceMs, untilMs)
          : ({ entries: [], floorMs: null } satisfies SourceResult),
      ]);

      const orphanedEvent = (eventId: string, runId: string): never => {
        throw new WorkflowStoreError(
          "corrupt_record",
          `factory_workflow_item_events "${eventId}" names run "${runId}", which has no row.`,
        );
      };
      const starterActor = (startedBy: string): ActivityActor =>
        startedBy === SCHEDULE_STARTER
          ? { kind: "schedule", email: null }
          : { kind: "person", email: startedBy };
      const merged: SourceResult["entries"] = [
        ...runRows.map(({ atMs, run }): RunActivity & { atMs: number } => ({
          kind: "run",
          id: `run:${run.id}`,
          atMs,
          at: run.startedAt,
          workflowId: run.workflowId,
          workflowName: run.workflowName,
          actor: starterActor(run.startedBy),
          link: { type: "run", workflowId: run.workflowId, runId: run.id },
          status: run.status,
          mode: run.mode,
          triggerKind: run.triggerKind,
          counts: run.counts,
          error: run.error,
        })),
        ...needsRows.map((entry): NeedsYouActivity & { atMs: number } => ({
          kind: "needs_you",
          id: `needs_you:${entry.eventId}`,
          atMs: entry.atMs,
          at: entry.at,
          workflowId: entry.workflowId,
          workflowName: entry.workflowName,
          actor: starterActor(
            entry.startedBy ?? orphanedEvent(entry.eventId, entry.runId),
          ),
          link: {
            type: "item",
            workflowId: entry.workflowId,
            itemId: entry.item.id,
          },
          item: entry.item,
          nodeId: entry.nodeId,
          reason: entry.reason,
          reasonTruncated: entry.reasonTruncated,
        })),
        ...changes.entries,
      ].sort(newestFirst);

      // Nothing older than the audit scan's frontier may be returned yet, or
      // the audit rows between would never be reached.
      const floor = changes.floorMs;
      const complete =
        floor === null ? merged : merged.filter((entry) => entry.atMs >= floor);
      const page = complete.slice(0, limit);
      const hasMore = complete.length > limit || floor !== null;

      let nextCursor: string | null = null;
      if (hasMore) {
        const last = page[page.length - 1];
        const at = last === undefined ? floor : last.atMs;
        if (at === null) {
          throw new WorkflowReadError(
            "invalid_input",
            "The activity page has more entries but no position to continue from.",
          );
        }
        const seen = [
          ...(position !== undefined && position.atMs === at
            ? position.seen
            : []),
          ...page.filter((entry) => entry.atMs === at).map((entry) => entry.id),
        ];
        if (seen.length > READ_LIMITS.pageMax * 2) {
          throw new WorkflowReadError(
            "invalid_input",
            "Too many activity entries share one millisecond to page through; narrow the time range.",
            { atMs: at },
          );
        }
        nextCursor = encodeActivityCursor({ atMs: at, seen });
      }
      return {
        entries: page.map(
          ({ atMs: _atMs, ...entry }) => entry as ActivityEntry,
        ),
        hasMore,
        nextCursor,
      };
    },
  };
}
