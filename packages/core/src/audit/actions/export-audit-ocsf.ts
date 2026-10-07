import { z } from "zod";

import { defineAction } from "../../action.js";
import { auditEventToOcsf, OCSF_SCHEMA_VERSION } from "../ocsf.js";
import { resolveAuditReadScope } from "../read-scope.js";
import { MAX_LIMIT, queryAuditEventPage } from "../store.js";

// Rows are stamped when the action finishes and inserted a moment later, so a
// row can commit after a later one. Holding back the newest few seconds keeps
// an ascending cursor from stepping past a row that has not landed yet.
const SETTLE_MS = 5000;

const timeInput = z.union([z.number(), z.string()]);

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseTime(value: z.infer<typeof timeInput> | undefined, name: string) {
  if (value === undefined) return undefined;
  const ms =
    typeof value === "number"
      ? value
      : /^\d+$/.test(value.trim())
        ? Number(value)
        : Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw badRequest(`${name} must be an ISO 8601 timestamp or epoch ms.`);
  }
  return ms;
}

function encodeCursor(event: { createdAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([event.createdAt, event.id])).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  try {
    const [createdAt, id] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (Number.isFinite(createdAt) && typeof id === "string" && id) {
      return { createdAt, id };
    }
    // coercion-ok: an undecodable cursor falls through to the typed 400 below.
  } catch {
    // Falls through to the 400 below.
  }
  throw badRequest("cursor is not a cursor returned by this action.");
}

export default defineAction({
  description: `Export the organization's audit trail as OCSF ${OCSF_SCHEMA_VERSION} API Activity events (class 6003) for a SIEM. Owners and admins only; returns the organization's shared trail (org and admins events), oldest first. Pull incrementally: pass the previous nextCursor as cursor, and keep it when a page comes back empty. Use list-audit-events instead to browse or answer 'what changed'.`,
  schema: z.object({
    since: timeInput
      .optional()
      .describe("Only events at or after this ISO 8601 timestamp or epoch ms."),
    until: timeInput
      .optional()
      .describe("Only events before this ISO 8601 timestamp or epoch ms."),
    cursor: z
      .string()
      .optional()
      .describe("The nextCursor from the previous page; resumes after it."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe("Max events per page (default 100, max 500)."),
  }),
  http: { method: "GET" },
  audit: {
    onRead: true,
    summary: () => "Exported audit events as OCSF",
  },
  run: async (args, ctx) => {
    const scope = await resolveAuditReadScope(ctx, "organization");
    const sinceMs = parseTime(args.since, "since");
    const untilMs = parseTime(args.until, "until");
    const after = args.cursor ? decodeCursor(args.cursor) : undefined;
    const page = await queryAuditEventPage(scope, {
      order: "asc",
      limit: args.limit,
      ...(sinceMs !== undefined ? { sinceMs } : {}),
      beforeMs: Math.min(untilMs ?? Infinity, Date.now() - SETTLE_MS),
      ...(after ? { after } : {}),
    });
    const last = page.events[page.events.length - 1];
    return {
      events: page.events.map(auditEventToOcsf),
      hasMore: page.hasMore,
      // An empty page keeps the caller's position instead of resetting it.
      nextCursor: last ? encodeCursor(last) : (args.cursor ?? null),
    };
  },
});
