/**
 * POST /api/view-event
 *
 * Tracks a viewer's interaction with a recording. Public endpoint — no auth
 * required so anonymous (public-share) viewers can be counted.
 *
 * Body:
 *   {
 *     recordingId: string,
 *     kind: "view-start" | "watch-progress" | "seek" | "pause" | "resume"
 *         | "cta-click" | "reaction",
 *     timestampMs?: number,
 *     payload?: object,
 *     viewerEmail?: string,      // ignored; authenticated session is authoritative
 *     viewerName?: string,
 *     sessionId: string,         // anonymous-viewer key (persisted in browser)
 *     viewSessionId?: string,    // per-player-open key for counted visits
 *     totalWatchMs?: number,     // current session's accumulated watch time
 *     completedPct?: number,     // 0–100, derived client-side
 *     scrubbedToEnd?: boolean,
 *   }
 *
 * Upserts a recording_viewers row keyed by (recordingId, viewerEmail || sessionId)
 * and inserts a recording_events row. On first satisfaction of the
 * 5s/75%/end-scrub rule, sets countedView=true.
 */

import { writeAppState } from "@agent-native/core/application-state";
import { emit } from "@agent-native/core/event-bus";
import {
  getSession,
  readBodyWithSizeLimit,
  runWithRequestContext,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { defineEventHandler, getRequestIP, setResponseStatus } from "h3";

import { getDb, schema } from "../../db/index.js";
import { nanoid, shouldCountView } from "../../lib/recordings.js";

interface ViewEventBody {
  recordingId?: string;
  kind?:
    | "view-start"
    | "watch-progress"
    | "seek"
    | "pause"
    | "resume"
    | "cta-click"
    | "reaction";
  timestampMs?: number;
  payload?: Record<string, unknown>;
  viewerEmail?: string;
  viewerName?: string;
  sessionId?: string;
  viewSessionId?: string;
  totalWatchMs?: number;
  completedPct?: number;
  scrubbedToEnd?: boolean;
}

const ALLOWED_KINDS = new Set([
  "view-start",
  "watch-progress",
  "seek",
  "pause",
  "resume",
  "cta-click",
  "reaction",
]);

// Simple in-memory rate limiter — per IP per 10s window.
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_MAX_BUCKETS = 5000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ID_CHARS = 256;
const MAX_VIEWER_NAME_CHARS = 200;
const MAX_EVENT_TIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const rateBuckets = new Map<string, { count: number; reset: number }>();

function pruneExpiredRateBuckets(now: number): void {
  for (const [key, bucket] of rateBuckets) {
    if (bucket.reset < now) rateBuckets.delete(key);
  }
}

function rateLimit(key: string): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.reset < now) {
    if (existing) rateBuckets.delete(key);
    if (rateBuckets.size >= RATE_LIMIT_MAX_BUCKETS) {
      pruneExpiredRateBuckets(now);
      if (rateBuckets.size >= RATE_LIMIT_MAX_BUCKETS) return false;
    }
    rateBuckets.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) return false;
  existing.count += 1;
  return true;
}

export function __resetViewEventRateLimitForTests(): void {
  rateBuckets.clear();
}

function boundedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxChars ? trimmed : null;
}

function boundedNumber(
  value: unknown,
  defaultValue: number,
  max: number,
): number | null {
  const resolved = value === undefined ? defaultValue : value;
  return typeof resolved === "number" &&
    Number.isFinite(resolved) &&
    resolved >= 0 &&
    resolved <= max
    ? resolved
    : null;
}

function serializedPayload(value: unknown): string | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    return new TextEncoder().encode(serialized).byteLength <= MAX_PAYLOAD_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

export default defineEventHandler(async (event) => {
  let body: ViewEventBody | null;
  try {
    body = await readBodyWithSizeLimit<ViewEventBody>(event, MAX_BODY_BYTES);
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    setResponseStatus(event, statusCode === 413 ? 413 : 400);
    return {
      error:
        statusCode === 413 ? "Request body too large" : "Invalid request body",
    };
  }
  if (!body || typeof body !== "object") {
    setResponseStatus(event, 400);
    return { error: "Invalid body" };
  }

  const recordingId = boundedString(body.recordingId, MAX_ID_CHARS);
  const sessionId = boundedString(body.sessionId, MAX_ID_CHARS);
  const viewSessionId =
    body.viewSessionId === undefined
      ? null
      : boundedString(body.viewSessionId, MAX_ID_CHARS);
  const viewerName =
    body.viewerName === undefined
      ? null
      : boundedString(body.viewerName, MAX_VIEWER_NAME_CHARS);
  const timestampMs = boundedNumber(body.timestampMs, 0, MAX_EVENT_TIME_MS);
  const totalWatchMs = boundedNumber(body.totalWatchMs, 0, MAX_EVENT_TIME_MS);
  const completedPct = boundedNumber(body.completedPct, 0, 100);
  const payload = serializedPayload(body.payload ?? {});

  if (!recordingId) {
    setResponseStatus(event, 400);
    return {
      error: "recordingId is required and must be at most 256 characters",
    };
  }
  if (!body.kind || !ALLOWED_KINDS.has(body.kind)) {
    setResponseStatus(event, 400);
    return { error: `Invalid kind: ${body.kind}` };
  }
  if (!sessionId) {
    setResponseStatus(event, 400);
    return {
      error: "sessionId is required and must be at most 256 characters",
    };
  }
  if (body.viewSessionId !== undefined && !viewSessionId) {
    setResponseStatus(event, 400);
    return { error: "viewSessionId must be at most 256 characters" };
  }
  if (body.viewerName !== undefined && !viewerName) {
    setResponseStatus(event, 400);
    return { error: "viewerName must be at most 200 characters" };
  }
  if (timestampMs === null || totalWatchMs === null || completedPct === null) {
    setResponseStatus(event, 400);
    return { error: "Invalid view metrics" };
  }
  if (
    body.scrubbedToEnd !== undefined &&
    typeof body.scrubbedToEnd !== "boolean"
  ) {
    setResponseStatus(event, 400);
    return { error: "scrubbedToEnd must be a boolean" };
  }
  if (payload === null) {
    setResponseStatus(event, 400);
    return { error: "payload must be a plain object no larger than 8 KiB" };
  }

  // Rate limit by IP + sessionId.
  // Deliberately do not opt into x-forwarded-for parsing: only the hosting
  // adapter's resolved peer address is trusted for this process-local guard.
  const ip = getRequestIP(event) || "unknown";
  if (!rateLimit(`${ip}:${sessionId}`)) {
    setResponseStatus(event, 429);
    return { error: "Rate limit exceeded" };
  }

  const session = await getSession(event).catch(() => null);
  const sessionEmail = session?.email;
  const viewerEmail = sessionEmail ?? null;
  const resolvedViewerName = viewerName ?? sessionEmail?.split("@")[0] ?? null;
  const now = new Date().toISOString();
  const kind = body.kind;
  const scrubbedToEnd = body.scrubbedToEnd ?? false;

  return runWithRequestContext(
    { userEmail: sessionEmail, orgId: session?.orgId },
    async () => {
      const access = await resolveAccess("recording", recordingId);
      if (!access) {
        // Do not leak whether a private/org-only recording exists. Public
        // share pages and authenticated players both have resolveAccess().
        return { ok: true, ignored: true };
      }

      const db = getDb();
      const rec = access.resource;

      // Find or create a recording_viewers row keyed by viewerEmail (if
      // present) else sessionId. We store the session id in the viewer_name
      // column as a best-effort fallback so anon sessions don't conflate.
      const viewerKey = viewerEmail ?? `anon:${sessionId}`;
      const countedViewSessionId = viewSessionId ?? `legacy:${sessionId}`;

      const selectViewerByKey = () =>
        db
          .select({
            id: schema.recordingViewers.id,
            totalWatchMs: schema.recordingViewers.totalWatchMs,
            completedPct: schema.recordingViewers.completedPct,
            countedView: schema.recordingViewers.countedView,
            ctaClicked: schema.recordingViewers.ctaClicked,
          })
          .from(schema.recordingViewers)
          .where(
            and(
              eq(schema.recordingViewers.recordingId, recordingId),
              eq(schema.recordingViewers.viewerKey, viewerKey),
            ),
          )
          .limit(1);

      let [existing] = await selectViewerByKey();
      if (!existing) {
        const legacyIdentity = viewerEmail
          ? eq(schema.recordingViewers.viewerEmail, viewerEmail)
          : and(
              isNull(schema.recordingViewers.viewerEmail),
              eq(schema.recordingViewers.viewerName, viewerKey),
            );
        const [legacy] = await db
          .select({ id: schema.recordingViewers.id })
          .from(schema.recordingViewers)
          .where(
            and(
              eq(schema.recordingViewers.recordingId, recordingId),
              isNull(schema.recordingViewers.viewerKey),
              legacyIdentity,
            ),
          )
          .orderBy(
            asc(schema.recordingViewers.firstViewedAt),
            asc(schema.recordingViewers.id),
          )
          .limit(1);

        if (legacy) {
          await db
            .update(schema.recordingViewers)
            .set({ viewerKey })
            .where(
              and(
                eq(schema.recordingViewers.id, legacy.id),
                eq(schema.recordingViewers.recordingId, recordingId),
                isNull(schema.recordingViewers.viewerKey),
              ),
            );
        } else {
          await db
            .insert(schema.recordingViewers)
            .values({
              id: nanoid(),
              recordingId,
              viewerKey,
              viewerEmail,
              viewerName: viewerEmail ? resolvedViewerName : viewerKey,
              firstViewedAt: now,
              lastViewedAt: now,
              totalWatchMs: 0,
              completedPct: 0,
              countedView: false,
              ctaClicked: false,
            })
            .onConflictDoNothing();
        }
        [existing] = await selectViewerByKey();
      }

      if (!existing) {
        throw new Error("Failed to resolve canonical recording viewer");
      }

      const viewerId = existing.id;
      const newTotalWatchMs = Math.max(
        existing.totalWatchMs,
        Math.floor(totalWatchMs),
      );
      const newCompletedPct = Math.max(
        existing.completedPct,
        Math.floor(completedPct),
      );
      const meetsThreshold = shouldCountView(
        newTotalWatchMs,
        newCompletedPct,
        scrubbedToEnd,
      );

      const persisted = await db.transaction(async (tx) => {
        await tx
          .update(schema.recordingViewers)
          .set({
            lastViewedAt: now,
            totalWatchMs: sql`CASE WHEN ${schema.recordingViewers.totalWatchMs} > ${Math.floor(totalWatchMs)} THEN ${schema.recordingViewers.totalWatchMs} ELSE ${Math.floor(totalWatchMs)} END`,
            completedPct: sql`CASE WHEN ${schema.recordingViewers.completedPct} > ${Math.floor(completedPct)} THEN ${schema.recordingViewers.completedPct} ELSE ${Math.floor(completedPct)} END`,
            ...(meetsThreshold ? { countedView: true } : {}),
            ...(kind === "cta-click" ? { ctaClicked: true } : {}),
          })
          .where(
            and(
              eq(schema.recordingViewers.recordingId, recordingId),
              eq(schema.recordingViewers.viewerKey, viewerKey),
            ),
          );

        await tx.insert(schema.recordingEvents).values({
          id: nanoid(),
          recordingId,
          viewerId,
          kind,
          timestampMs: Math.floor(timestampMs),
          payload,
          createdAt: now,
        });

        if (meetsThreshold) {
          await tx
            .insert(schema.recordingViews)
            .values({
              id: nanoid(),
              recordingId,
              viewerId,
              viewerKey,
              viewSessionId: countedViewSessionId,
              viewerEmail,
              viewerName: viewerEmail ? resolvedViewerName : viewerKey,
              viewedAt: now,
            })
            .onConflictDoNothing();
        }

        const [updated] = await tx
          .select({
            countedView: schema.recordingViewers.countedView,
          })
          .from(schema.recordingViewers)
          .where(
            and(
              eq(schema.recordingViewers.recordingId, recordingId),
              eq(schema.recordingViewers.viewerKey, viewerKey),
            ),
          )
          .limit(1);
        if (!updated) throw new Error("Canonical recording viewer disappeared");
        return updated;
      });

      // Only broadcast a refresh signal on "meaningful" events to avoid
      // spamming the polling clients every 2s with watch-progress
      // heartbeats. Skip for anonymous viewers — application_state writes
      // require an authenticated request context, and a public-share
      // viewer has no UI tab to invalidate anyway.
      if (kind !== "watch-progress" && sessionEmail) {
        await writeAppState("refresh-signal", { ts: Date.now() });
      }

      // Emit clip.viewed event on view-start — best-effort, never block the response.
      if (kind === "view-start") {
        try {
          emit(
            "clip.viewed",
            {
              clipId: recordingId,
              viewerEmail: viewerEmail ?? null,
              viewedAt: now,
            },
            { owner: rec.ownerEmail ?? undefined },
          );
        } catch (err) {
          console.warn("[view-event] clip.viewed emit failed:", err);
        }
      }

      return { ok: true, viewerId, countedView: persisted.countedView };
    },
  );
});
