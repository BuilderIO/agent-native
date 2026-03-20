import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import * as chrono from "chrono-node";

// ─── NL Date Parsing ──────────────────────────────────────────────────────────

function ianaToOffsetMinutes(iana: string, ref: Date): number {
  try {
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: iana,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(ref);
    const offsetStr =
      parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const match = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!match) return 0;
    const sign = match[1] === "+" ? 1 : -1;
    return sign * (parseInt(match[2]) * 60 + parseInt(match[3] ?? "0"));
  } catch {
    return 0;
  }
}

export function parseNlDate(input: string, timezone: string): Date | null {
  const ref = new Date();
  const result = chrono.parseDate(input, ref, {
    timezone: ianaToOffsetMinutes(timezone, ref),
    forwardDate: true,
  } as any);
  if (!result) return null;
  // Default to 8am when no time component present
  if (!input.match(/\d{1,2}[:.]\d{2}|[ap]m/i)) {
    result.setHours(8, 0, 0, 0);
  }
  return result;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/** GET /api/scheduled-jobs — list pending/processing jobs */
export const listScheduledJobs = defineEventHandler((_event: H3Event) => {
  const jobs = db
    .select()
    .from(schema.scheduledJobs)
    .where(inArray(schema.scheduledJobs.status, ["pending", "processing"]))
    .all();
  return jobs;
});

/** POST /api/scheduled-jobs — create a new job */
export const createScheduledJob = defineEventHandler(
  async (event: H3Event) => {
    const body = await readBody(event);
    const { type, emailId, payload, runAt } = body as {
      type: "snooze" | "send_later";
      emailId?: string;
      payload?: Record<string, unknown>;
      runAt: number;
    };

    if (!type || !runAt) {
      setResponseStatus(event, 400);
      return { error: "type and runAt are required" };
    }

    const job = {
      id: nanoid(12),
      type,
      emailId: emailId ?? null,
      payload: JSON.stringify(payload ?? {}),
      runAt,
      status: "pending" as const,
      createdAt: Date.now(),
    };

    db.insert(schema.scheduledJobs).values(job).run();
    setResponseStatus(event, 201);
    return job;
  },
);

/** PATCH /api/scheduled-jobs/:id — reschedule (update runAt, reset to pending) */
export const updateScheduledJob = defineEventHandler(
  async (event: H3Event) => {
    const id = getRouterParam(event, "id");
    if (!id) {
      setResponseStatus(event, 400);
      return { error: "id required" };
    }

    const body = await readBody(event);
    const { runAt } = body as { runAt?: number };

    if (!runAt) {
      setResponseStatus(event, 400);
      return { error: "runAt is required" };
    }

    const existing = db
      .select()
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.id, id))
      .get();

    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Job not found" };
    }

    db.update(schema.scheduledJobs)
      .set({ runAt, status: "pending" } as any)
      .where(eq(schema.scheduledJobs.id, id))
      .run();

    return { ...existing, runAt, status: "pending" };
  },
);

/** DELETE /api/scheduled-jobs/:id — cancel (set status = cancelled) */
export const deleteScheduledJob = defineEventHandler((event: H3Event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  db.update(schema.scheduledJobs)
    .set({ status: "cancelled" } as any)
    .where(eq(schema.scheduledJobs.id, id))
    .run();

  return { ok: true };
});

/** POST /api/parse-date — NL date parsing (for UI preview) */
export const parseDateNl = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { nlInput, timezone } = body as {
    nlInput?: string;
    timezone?: string;
  };

  if (!nlInput) {
    setResponseStatus(event, 400);
    return { error: "nlInput is required" };
  }

  const tz = timezone || "UTC";
  const date = parseNlDate(nlInput, tz);

  if (!date) {
    return { timestamp: null, formatted: null };
  }

  return {
    timestamp: date.getTime(),
    formatted: date.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  };
});
