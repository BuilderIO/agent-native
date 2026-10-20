import type { ItemsStrings } from "../items-strings";
import { formatUntil } from "./format";
import type { ItemParking, NeedsYouReason } from "./read-types";

export type PhaseKey =
  | "needs_you"
  | "waiting"
  | "failed"
  | "dismissed"
  | "done"
  | "active"
  | "in_flow"
  | "other";

export type ChipTone = "attention" | "waiting" | "neutral";

export interface ItemPhase {
  key: PhaseKey;
  label: string;
  tone: ChipTone;
}

const DONE_STATUSES = new Set(["resolved", "merged", "auto_approved"]);
const FAILED_STATUSES = new Set(["failed", "reconciliation_required"]);
const ACTIVE_STATUSES = new Set(["automation_started", "pr_observed"]);

export function statusLabel(status: string, s: ItemsStrings): string {
  return s.status[status] ?? status;
}

export interface PhaseInput {
  status: string | null;
  parked: ItemParking | null;
  needsYouReasons: readonly NeedsYouReason[];
}

/**
 * The one chip an item row carries. A person's attention outranks everything
 * else, then waiting, then the inbox status. A status this build has no word
 * for is shown as stored, never folded into a generic label.
 */
export function itemPhase(input: PhaseInput, s: ItemsStrings): ItemPhase {
  const { status, parked, needsYouReasons } = input;
  if (needsYouReasons.length > 0 || status === "needs_manual") {
    return { key: "needs_you", label: s.phase.needsYou, tone: "attention" };
  }
  if (parked) {
    return { key: "waiting", label: s.phase.waiting, tone: "waiting" };
  }
  if (status === null) {
    return { key: "in_flow", label: s.phase.inFlow, tone: "neutral" };
  }
  if (FAILED_STATUSES.has(status)) {
    return { key: "failed", label: statusLabel(status, s), tone: "attention" };
  }
  if (status === "dismissed") {
    return { key: "dismissed", label: statusLabel(status, s), tone: "neutral" };
  }
  if (DONE_STATUSES.has(status)) {
    return { key: "done", label: statusLabel(status, s), tone: "neutral" };
  }
  if (ACTIVE_STATUSES.has(status)) {
    return { key: "active", label: statusLabel(status, s), tone: "neutral" };
  }
  return { key: "other", label: statusLabel(status, s), tone: "neutral" };
}

export function needsYouText(
  reasons: readonly NeedsYouReason[],
  s: ItemsStrings,
): string | null {
  if (reasons.length === 0) return null;
  return reasons
    .map((reason) => s.needsYouReason[reason] ?? reason)
    .join(s.listSeparator);
}

/** Where the item is right now, in words: its parking, else the step of its last event. */
export function whereText(
  row: {
    parked: ItemParking | null;
    lastNode: { nodeId: string; nodeName: string | null } | null;
  },
  nowMs: number,
  s: ItemsStrings,
  locale: string,
): string | null {
  const { parked, lastNode } = row;
  if (parked) {
    const until = formatUntil(parked.dueAt, nowMs, locale);
    switch (parked.wait) {
      case "reply":
        return s.where.parkedReply(until);
      case "time":
        return s.where.parkedTime(until);
      case "condition":
        return s.where.parkedCondition(until);
    }
  }
  if (lastNode) {
    return s.where.atNode(lastNode.nodeName ?? lastNode.nodeId);
  }
  return null;
}

export function sourceLabel(
  source: string | null,
  s: ItemsStrings,
): string | null {
  if (!source) return null;
  const known = s.source[source];
  if (known) return known;
  // A provider id such as "my_crm" reads better as a word.
  const words = source.replace(/[_-]+/g, " ").trim();
  return words.length === 0
    ? source
    : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

export function isSlackSource(source: string | null): boolean {
  return (source ?? "").toLowerCase().includes("slack");
}

export const KNOWN_SOURCE_IDS = [
  "slack",
  "github",
  "github_issue",
  "sentry",
  "hubspot",
  "pylon",
  "stripe",
  "gong",
  "jira",
  "notion",
  "posthog",
  "bigquery",
  "builder",
  "email",
] as const;
