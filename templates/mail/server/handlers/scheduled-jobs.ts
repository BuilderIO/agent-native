import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { readBody, getSession } from "@agent-native/core/server";
import * as chrono from "chrono-node";
import {
  createScheduledJobRecord,
  listPendingJobs,
  scheduleEmailSend,
  scheduleSnooze,
  type SendLaterPayload,
} from "../lib/jobs.js";

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
  const opts = {
    timezone: ianaToOffsetMinutes(timezone, ref),
    forwardDate: true,
  } as any;
  const parsed = chrono.parse(input, ref, opts);
  if (!parsed.length) return null;
  const result = parsed[0].start.date();
  // Default to 8am only when chrono didn't extract an explicit time component
  // (e.g. "tomorrow" → 8am, but "1 hour" or "3pm" keep their parsed time)
  const hasTime =
    parsed[0].start.isCertain("hour") || parsed[0].start.isCertain("minute");
  if (!hasTime) {
    result.setHours(8, 0, 0, 0);
  }
  return result;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/** GET /api/scheduled-jobs — list pending/processing jobs */
export const listScheduledJobs = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  return listPendingJobs(session?.email ?? "local@localhost");
});

/** POST /api/scheduled-jobs — create a new job */
export const createScheduledJob = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  const body = await readBody(event);
  const { type, emailId, threadId, accountEmail, payload, runAt } = body as {
    type: "snooze" | "send_later";
    emailId?: string;
    threadId?: string;
    accountEmail?: string;
    payload?: Record<string, unknown>;
    runAt: number;
  };

  if (!type || !runAt) {
    setResponseStatus(event, 400);
    return { error: "type and runAt are required" };
  }

  if (type !== "snooze" && type !== "send_later") {
    setResponseStatus(event, 400);
    return { error: "type must be 'snooze' or 'send_later'" };
  }

  if (!Number.isFinite(runAt) || runAt <= Date.now()) {
    setResponseStatus(event, 400);
    return { error: "runAt must be a future timestamp" };
  }

  const ownerEmail = session?.email ?? "local@localhost";
  const job = await createScheduledJobRecord({
    type,
    ownerEmail,
    emailId: emailId ?? null,
    threadId: threadId ?? null,
    accountEmail: accountEmail ?? (payload as any)?.accountEmail ?? null,
    payload,
    runAt,
  });
  setResponseStatus(event, 201);
  return job;
});

/** PATCH /api/scheduled-jobs/:id — reschedule (update runAt, reset to pending) */
export const updateScheduledJob = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  const body = await readBody(event);
  const { runAt } = body as { runAt?: number };

  if (!runAt || !Number.isFinite(runAt) || runAt <= Date.now()) {
    setResponseStatus(event, 400);
    return { error: "runAt must be a future timestamp" };
  }

  const [existing] = await db
    .select()
    .from(schema.scheduledJobs)
    .where(eq(schema.scheduledJobs.id, id));

  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Job not found" };
  }

  await db
    .update(schema.scheduledJobs)
    .set({ runAt, status: "pending" } as any)
    .where(eq(schema.scheduledJobs.id, id));

  return { ...existing, runAt, status: "pending" };
});

/** DELETE /api/scheduled-jobs/:id — cancel (set status = cancelled) */
export const deleteScheduledJob = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  await db
    .update(schema.scheduledJobs)
    .set({ status: "cancelled" } as any)
    .where(eq(schema.scheduledJobs.id, id));

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

export const snoozeEmail = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  const ownerEmail = session?.email ?? "local@localhost";
  const emailId = getRouterParam(event, "id");
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    runAt?: number;
    accountEmail?: string;
  };

  if (!emailId) {
    setResponseStatus(event, 400);
    return { error: "id required" };
  }

  if (!body.runAt || !Number.isFinite(body.runAt) || body.runAt <= Date.now()) {
    setResponseStatus(event, 400);
    return { error: "runAt must be a future timestamp" };
  }

  try {
    const job = await scheduleSnooze({
      ownerEmail,
      emailId,
      runAt: body.runAt,
      accountEmail: body.accountEmail,
    });
    setResponseStatus(event, 201);
    return job;
  } catch (error: any) {
    const message = error?.message || "Failed to snooze email";
    console.error("[snooze]", message, error);
    setResponseStatus(event, message === "Email not found" ? 404 : 500);
    return { error: message };
  }
});

export const scheduleEmail = defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event);
  const ownerEmail = session?.email ?? "local@localhost";
  const body = ((await readBody(event).catch(() => ({}))) ??
    {}) as SendLaterPayload & {
    runAt?: number;
  };

  if (!body.to || body.subject === undefined || body.body === undefined) {
    setResponseStatus(event, 400);
    return { error: "Missing required fields: to, subject, body" };
  }

  if (!body.runAt || !Number.isFinite(body.runAt) || body.runAt <= Date.now()) {
    setResponseStatus(event, 400);
    return { error: "runAt must be a future timestamp" };
  }

  const job = await scheduleEmailSend({
    ownerEmail,
    runAt: body.runAt,
    payload: {
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      body: body.body,
      from: body.from,
      accountEmail: body.accountEmail,
      replyToId: body.replyToId,
      threadId: body.threadId,
    },
  });

  setResponseStatus(event, 201);
  return job;
});
