import {
  INBOX_RANGES,
  type InboxRange,
  parseInboxRange,
  updatedAfterForRange,
} from "@/components/factory/inbox-filters";

export const AUDIT_RANGES = INBOX_RANGES;
export type AuditRange = InboxRange;

export function parseAuditRange(value: string | null): AuditRange | "" {
  return parseInboxRange(value);
}

export function startedAfterForAuditRange(
  range: AuditRange | "",
): string | undefined {
  return updatedAfterForRange(range);
}

export function writeAuditFilterParam(
  params: URLSearchParams,
  key: "automation" | "range",
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (!value) next.delete(key);
  else next.set(key, value);
  return next;
}
