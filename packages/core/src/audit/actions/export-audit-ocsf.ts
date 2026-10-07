import { z } from "zod";

import { defineAction } from "../../action.js";
import { auditEventToOcsf, OCSF_SCHEMA_VERSION } from "../ocsf.js";
import { resolveAuditReadScope } from "../read-scope.js";
import { MAX_LIMIT, queryAuditEventPage } from "../store.js";

// Audit timestamps are assigned before inserts become visible. The settle delay
// and replay window keep a delayed insert from falling permanently behind the cursor.
const SETTLE_MS = 5000;
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

interface EventCursor {
  createdAt: number;
  id: string;
}

interface CursorBounds {
  sinceMs?: number;
  untilMs?: number;
}

type ExportCursor = CursorBounds &
  (
    | {
        version: 2;
        mode: "paging";
        after: EventCursor;
        beforeMs: number;
        watermarkMs: number;
      }
    | { version: 2; mode: "ready"; watermarkMs: number }
  );

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

function encodeCursor(cursor: ExportCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string): ExportCursor | EventCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (Array.isArray(parsed)) {
      const [createdAt, id] = parsed;
      if (Number.isFinite(createdAt) && typeof id === "string" && id) {
        return { createdAt, id };
      }
    } else if (parsed && typeof parsed === "object") {
      const value = parsed as Record<string, unknown>;
      if (
        value.version === 2 &&
        (value.mode === "ready" || value.mode === "paging") &&
        Number.isFinite(value.watermarkMs) &&
        (value.sinceMs === undefined || Number.isFinite(value.sinceMs)) &&
        (value.untilMs === undefined || Number.isFinite(value.untilMs))
      ) {
        const bounds = {
          ...(typeof value.sinceMs === "number"
            ? { sinceMs: value.sinceMs }
            : {}),
          ...(typeof value.untilMs === "number"
            ? { untilMs: value.untilMs }
            : {}),
        };
        if (value.mode === "ready") {
          return {
            version: 2,
            mode: "ready",
            watermarkMs: value.watermarkMs as number,
            ...bounds,
          };
        }
        const after = value.after as Record<string, unknown> | null;
        if (
          Number.isFinite(value.beforeMs) &&
          after !== null &&
          typeof after === "object" &&
          Number.isFinite(after.createdAt) &&
          typeof after.id === "string" &&
          after.id
        ) {
          return {
            version: 2,
            mode: "paging",
            after: { createdAt: after.createdAt as number, id: after.id },
            beforeMs: value.beforeMs as number,
            watermarkMs: value.watermarkMs as number,
            ...bounds,
          };
        }
      }
    }
    // coercion-ok: malformed cursors fall through to the typed 400 below.
  } catch {
    // Falls through to the 400 below.
  }
  throw badRequest("cursor is not a cursor returned by this action.");
}

function assertCursorBounds(cursor: ExportCursor, bounds: CursorBounds): void {
  if (
    (bounds.sinceMs !== undefined && bounds.sinceMs !== cursor.sinceMs) ||
    (bounds.untilMs !== undefined && bounds.untilMs !== cursor.untilMs)
  ) {
    throw badRequest(
      "since and until must match the values used with this cursor.",
    );
  }
}

export default defineAction({
  description: `Export the organization's audit trail as OCSF ${OCSF_SCHEMA_VERSION} API Activity events (class 6003) for a SIEM. Owners and admins only; returns the organization's shared trail (org and admins events), oldest first. Pull incrementally: pass the previous nextCursor as cursor, and keep it when a page comes back empty. A five-minute rolling overlap can replay recent events to catch late commits; deduplicate across polls by metadata.uid. Use list-audit-events instead to browse or answer 'what changed'.`,
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
    const requestedSinceMs = parseTime(args.since, "since");
    const requestedUntilMs = parseTime(args.until, "until");
    const decoded = args.cursor ? decodeCursor(args.cursor) : undefined;
    const cursor = decoded && "version" in decoded ? decoded : undefined;
    if (cursor) {
      assertCursorBounds(cursor, {
        sinceMs: requestedSinceMs,
        untilMs: requestedUntilMs,
      });
    }
    const sinceMs = cursor?.sinceMs ?? requestedSinceMs;
    const untilMs = cursor?.untilMs ?? requestedUntilMs;
    const now = Date.now();
    const beforeMs =
      cursor?.mode === "paging"
        ? cursor.beforeMs
        : Math.min(untilMs ?? Infinity, now - SETTLE_MS);
    const after =
      cursor?.mode === "paging"
        ? cursor.after
        : decoded && "createdAt" in decoded
          ? decoded
          : cursor
            ? {
                createdAt: Math.max(0, cursor.watermarkMs - REPLAY_WINDOW_MS),
                id: "",
              }
            : undefined;
    const watermarkMs =
      cursor?.watermarkMs ??
      (decoded && "createdAt" in decoded ? decoded.createdAt : 0);
    const page = await queryAuditEventPage(scope, {
      order: "asc",
      limit: args.limit,
      ...(sinceMs !== undefined ? { sinceMs } : {}),
      beforeMs,
      ...(after ? { after } : {}),
    });
    const last = page.events[page.events.length - 1];
    const nextCursor =
      page.hasMore && last
        ? encodeCursor({
            version: 2,
            mode: "paging",
            after: { createdAt: last.createdAt, id: last.id },
            beforeMs,
            watermarkMs,
            ...(sinceMs !== undefined ? { sinceMs } : {}),
            ...(untilMs !== undefined ? { untilMs } : {}),
          })
        : encodeCursor({
            version: 2,
            mode: "ready",
            watermarkMs: Math.max(watermarkMs, beforeMs),
            ...(sinceMs !== undefined ? { sinceMs } : {}),
            ...(untilMs !== undefined ? { untilMs } : {}),
          });
    return {
      events: page.events.map(auditEventToOcsf),
      hasMore: page.hasMore,
      nextCursor,
    };
  },
});
