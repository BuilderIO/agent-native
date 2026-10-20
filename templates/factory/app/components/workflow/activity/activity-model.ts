import type { ItemsStrings } from "../items-strings";
import { dayKey } from "../items/format";
import type {
  ActivityEntry,
  ActivityLink,
  RunActivity,
  RunStatus,
} from "../items/read-types";

export type ActivityKindFilter = "run" | "change" | "needs_you";
export type ActivityWhoFilter = "person" | "agent" | "schedule";
export type ActivityRange = "day" | "week" | "month" | "all";

export interface ActivityFilterState {
  workflowId: string | null;
  who: ActivityWhoFilter | null;
  kind: ActivityKindFilter | null;
  range: ActivityRange;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilterState = {
  workflowId: null,
  who: null,
  kind: null,
  range: "week",
};

const ACTIVITY_PAGE_SIZE = 25;

const RANGE_MS: Record<Exclude<ActivityRange, "all">, number> = {
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 30 * 24 * 60 * 60_000,
};

/** The start of the window, or null for all time. Computed once per choice: a moving bound would make every render a new query. */
export function rangeSince(range: ActivityRange, nowMs: number): string | null {
  return range === "all"
    ? null
    : new Date(nowMs - RANGE_MS[range]).toISOString();
}

export function activityQueryParams(
  factoryId: string,
  filters: ActivityFilterState,
  since: string | null,
): Record<string, unknown> {
  return {
    factoryId,
    limit: ACTIVITY_PAGE_SIZE,
    ...(filters.workflowId ? { workflowId: filters.workflowId } : {}),
    ...(filters.who ? { who: filters.who } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(since ? { since } : {}),
  };
}

export function hasActivityFilters(filters: ActivityFilterState): boolean {
  return (
    filters.workflowId !== null ||
    filters.who !== null ||
    filters.kind !== null ||
    filters.range !== DEFAULT_ACTIVITY_FILTERS.range
  );
}

interface DayBreak {
  key: string;
  at: string;
}

/**
 * Which entries of a page start a new day, given the day the previous page
 * ended on. The heading belongs to the entry, so a page boundary inside one
 * day draws no second heading.
 */
export function dayBreaks(
  entries: readonly ActivityEntry[],
  previousDay: string | undefined,
): { breaks: Map<string, DayBreak>; lastDay: string | undefined } {
  const breaks = new Map<string, DayBreak>();
  let current = previousDay;
  for (const entry of entries) {
    const key = dayKey(entry.at);
    if (key !== current) {
      breaks.set(entry.id, { key, at: entry.at });
      current = key;
    }
  }
  return { breaks, lastDay: current };
}

export function actorLabel(
  actor: ActivityEntry["actor"],
  s: ItemsStrings,
): string {
  if (actor.kind === "person" && actor.email) {
    return actor.email.split("@")[0] || actor.email;
  }
  return s.activity.actor[actor.kind];
}

const COUNT_ORDER = [
  "done",
  "dismissed",
  "needsManual",
  "released",
  "itemFailures",
  "needsCheck",
] as const;

/** "Took 3 items: 1 done, 1 dismissed, 1 handed to a person", or "Nothing new". */
export function describeRunCounts(
  counts: RunActivity["counts"],
  s: ItemsStrings,
): string {
  const taken = counts.taken ?? 0;
  const parts: string[] = [];
  for (const key of COUNT_ORDER) {
    const count = counts[key] ?? 0;
    if (count > 0) parts.push(s.activity.runCounts[key](count));
  }
  if (taken === 0 && parts.length === 0) return s.activity.runCounts.nothing;
  const head = s.activity.runCounts.taken(taken);
  return parts.length === 0
    ? head
    : s.activity.runCounts.summary(head, parts.join(s.listSeparator));
}

interface RunStatusView {
  label: string;
  tone: "attention" | "waiting" | "neutral";
}

export function runStatusView(
  status: RunStatus,
  s: ItemsStrings,
): RunStatusView {
  const label = s.activity.runStatus[status];
  if (status === "failed") return { label, tone: "attention" };
  if (status === "paused") return { label, tone: "waiting" };
  return { label, tone: "neutral" };
}

export type LinkAction =
  | { kind: "run"; workflowId: string; runId: string; label: string }
  | {
      kind: "version";
      workflowId: string;
      version: number | null;
      label: string;
    }
  | { kind: "item"; workflowId: string; itemId: string; label: string };

/**
 * Where an entry's link goes. A deleted workflow has nothing left to open, so
 * its change entry carries no link rather than one that would fail.
 */
export function linkAction(
  entry: ActivityEntry,
  s: ItemsStrings,
): LinkAction | null {
  if (entry.kind === "change" && entry.change === "deleted") return null;
  return linkFor(entry.link, s);
}

function linkFor(link: ActivityLink, s: ItemsStrings): LinkAction {
  switch (link.type) {
    case "run":
      return {
        kind: "run",
        workflowId: link.workflowId,
        runId: link.runId,
        label: s.activity.link.run,
      };
    case "version":
      return {
        kind: "version",
        workflowId: link.workflowId,
        version: link.version,
        label: s.activity.link.version(link.version),
      };
    case "item":
      return {
        kind: "item",
        workflowId: link.workflowId,
        itemId: link.itemId,
        label: s.activity.link.item,
      };
  }
}
