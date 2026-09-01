export const INBOX_STATUSES = [
  "received",
  "context_fetching",
  "evidence_ready",
  "classified",
  "shadow_decided",
  "needs_manual",
  "failed",
  "reconciliation_required",
  "automation_started",
  "pr_observed",
  "auto_approved",
  "merged",
] as const;

export const INBOX_RISKS = [
  "unknown",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const INBOX_SOURCES = [
  "slack",
  "github",
  "github_issue",
  "sentry",
] as const;

export const INBOX_RANGES = ["today", "7d"] as const;

export type InboxStatus = (typeof INBOX_STATUSES)[number];
export type InboxRisk = (typeof INBOX_RISKS)[number];
export type InboxSource = (typeof INBOX_SOURCES)[number];
export type InboxRange = (typeof INBOX_RANGES)[number];

export function parseInboxStatus(value: string | null): InboxStatus | "" {
  return INBOX_STATUSES.includes(value as InboxStatus)
    ? (value as InboxStatus)
    : "";
}

export function parseInboxRisk(value: string | null): InboxRisk | "" {
  return INBOX_RISKS.includes(value as InboxRisk) ? (value as InboxRisk) : "";
}

export function parseInboxSource(value: string | null): InboxSource | "" {
  return INBOX_SOURCES.includes(value as InboxSource)
    ? (value as InboxSource)
    : "";
}

export function parseInboxRange(value: string | null): InboxRange | "" {
  return INBOX_RANGES.includes(value as InboxRange)
    ? (value as InboxRange)
    : "";
}

export function updatedAfterForRange(
  range: InboxRange | "",
): string | undefined {
  if (!range) return undefined;
  // Local midnight so the bound is stable across renders. `now - 7d` would
  // change every millisecond and retrigger list-triage-items via the query key.
  const now = new Date();
  const daysAgo = range === "today" ? 0 : 7;
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysAgo,
  ).toISOString();
}

export function writeInboxFilterParam(
  params: URLSearchParams,
  key: "status" | "risk" | "range" | "source",
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (!value) next.delete(key);
  else next.set(key, value);
  return next;
}
