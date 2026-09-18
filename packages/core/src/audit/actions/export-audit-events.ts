import { z } from "zod";

import { defineAction } from "../../action.js";
import { MAX_LIMIT, queryAuditEvents } from "../store.js";
import type { AuditEvent } from "../types.js";

const DEFAULT_MAX_ROWS = 5000;
const HARD_CAP_ROWS = 10000;

// Deterministic column order for CSV — mirrors the store's list projection
// (`LIST_COLUMNS`), which deliberately excludes `input` so a bulk export
// never streams every event's (redacted) request body at once. Future
// columns added to the audit store must be reflected here too.
const CSV_COLUMNS: Array<[key: keyof AuditEvent, header: string]> = [
  ["id", "id"],
  ["createdAt", "created_at"],
  ["action", "action"],
  ["caller", "caller"],
  ["actorKind", "actor_kind"],
  ["actorEmail", "actor_email"],
  ["orgId", "org_id"],
  ["threadId", "thread_id"],
  ["turnId", "turn_id"],
  ["targetType", "target_type"],
  ["targetId", "target_id"],
  ["status", "status"],
  ["summary", "summary"],
  ["errorCode", "error_code"],
  ["ownerEmail", "owner_email"],
  ["visibility", "visibility"],
];

/** Hand-rolled CSV field escaper — quotes a field when it contains a comma,
 *  quote, or newline, doubling any embedded quotes. No dependency needed for
 *  ~10 lines of RFC 4180 escaping. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(events: AuditEvent[]): string {
  const header = CSV_COLUMNS.map(([, label]) => label).join(",");
  const rows = events.map((event) =>
    CSV_COLUMNS.map(([key]) => csvField(event[key])).join(","),
  );
  return [header, ...rows].join("\n");
}

function toNdjson(events: AuditEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

/**
 * Bulk-export audit-log events as CSV or NDJSON — the "bulk export" sensitive
 * read the audit doc itself names. Pages past the per-call row clamp
 * (`queryAuditEvents`'s `MAX_LIMIT`) up to `maxRows`, scoped in SQL to the
 * caller's identity exactly like `list-audit-events`. Read-only; never
 * exposes other tenants' rows.
 */
export default defineAction({
  description:
    "Export audit-log events as a CSV or NDJSON document for offline/compliance pulls (up to maxRows, default 5000, hard cap 10000). Use this instead of hand-paging list-audit-events when you need a bulk download of the trail; use list-audit-events instead for browsing recent activity or answering 'what changed'.",
  schema: z.object({
    targetType: z
      .string()
      .optional()
      .describe("Filter to one resource type, e.g. 'recording'."),
    targetId: z
      .string()
      .optional()
      .describe("Filter to one resource id (pair with targetType)."),
    actorKind: z
      .enum(["agent", "human", "system"])
      .optional()
      .describe("Filter to changes made by the agent, a human, or the system."),
    actorEmail: z.string().optional().describe("Filter to one actor's email."),
    status: z
      .enum(["success", "error", "denied"])
      .optional()
      .describe("Filter by outcome."),
    threadId: z.string().optional().describe("Filter to one agent thread."),
    turnId: z
      .string()
      .optional()
      .describe("Filter to one agent turn (a single agent response)."),
    action: z.string().optional().describe("Filter to one action name."),
    sinceMs: z
      .number()
      .optional()
      .describe("Only events at or after this Unix epoch (ms)."),
    format: z
      .enum(["csv", "ndjson"])
      .default("csv")
      .describe(
        "Export format — CSV with a header row, or one JSON event per line.",
      ),
    maxRows: z
      .number()
      .optional()
      .describe("Max rows to export (default 5000, hard cap 10000)."),
  }),
  http: { method: "GET" },
  audit: {
    // Read-only actions are skipped by default — this is exactly the
    // "bulk export" sensitive read the framework's own audit doc calls out.
    onRead: true,
    summary: (args) =>
      `Bulk export of audit events (${(args as { format?: string }).format ?? "csv"})`,
  },
  run: async (args, ctx) => {
    const scope = { userEmail: ctx?.userEmail, orgId: ctx?.orgId ?? null };
    const cap = Math.min(
      Math.max(1, Math.floor(args.maxRows ?? DEFAULT_MAX_ROWS)),
      HARD_CAP_ROWS,
    );

    const filters = {
      ...(args.targetType ? { targetType: args.targetType } : {}),
      ...(args.targetId ? { targetId: args.targetId } : {}),
      ...(args.actorKind ? { actorKind: args.actorKind } : {}),
      ...(args.actorEmail ? { actorEmail: args.actorEmail } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.turnId ? { turnId: args.turnId } : {}),
      ...(args.action ? { action: args.action } : {}),
      ...(typeof args.sinceMs === "number" ? { sinceMs: args.sinceMs } : {}),
    };

    const events: AuditEvent[] = [];
    let offset = 0;
    while (events.length < cap) {
      const pageLimit = Math.min(MAX_LIMIT, cap - events.length);
      const page = await queryAuditEvents(scope, {
        ...filters,
        limit: pageLimit,
        offset,
      });
      events.push(...page);
      offset += page.length;
      if (page.length < pageLimit) break; // exhausted — no more matching rows
    }

    // We stopped because we hit the cap, not because we ran out of rows —
    // probe one more row to know whether the export was actually truncated.
    let truncated = false;
    if (events.length >= cap) {
      const probe = await queryAuditEvents(scope, {
        ...filters,
        limit: 1,
        offset,
      });
      truncated = probe.length > 0;
    }

    const content = args.format === "ndjson" ? toNdjson(events) : toCsv(events);
    return { content, rowCount: events.length, truncated, format: args.format };
  },
});
