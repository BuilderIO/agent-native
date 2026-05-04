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
 *     viewerEmail?: string,      // server falls back to session when present
 *     viewerName?: string,
 *     sessionId: string,         // anonymous-viewer key (persisted in browser)
 *     totalWatchMs?: number,     // current session's accumulated watch time
 *     completedPct?: number,     // 0–100, derived client-side
 *     scrubbedToEnd?: boolean,
 *   }
 *
 * Upserts a recording_viewers row keyed by (recordingId, viewerEmail || sessionId)
 * and inserts a recording_events row. On first satisfaction of the
 * 5s/75%/end-scrub rule, sets countedView=true.
 */

import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { nanoid, shouldCountView } from "../../lib/recordings.js";
import {
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";
import { emit } from "@agent-native/core/event-bus";
import { resolveAccess } from "@agent-native/core/sharing";

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
const rateBuckets = new Map<string, { count: number; reset: number }>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.reset < now) {
    rateBuckets.set(key, { count: 1, reset: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) return false;
  existing.count += 1;
  return true;
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(
    () => null,
  )) as ViewEventBody | null;
  if (!body || typeof body !== "object") {
    setResponseStatus(event, 400);
    return { error: "Invalid body" };
  }

  const {
    recordingId,
    kind,
    timestampMs = 0,
    payload = {},
    sessionId,
    totalWatchMs = 0,
    completedPct = 0,
    scrubbedToEnd = false,
  } = body;

  if (!recordingId || typeof recordingId !== "string") {
    setResponseStatus(event, 400);
    return { error: "recordingId is required" };
  }
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    setResponseStatus(event, 400);
    return { error: `Invalid kind: ${kind}` };
  }
  if (!sessionId || typeof sessionId !== "string") {
    setResponseStatus(event, 400);
    return { error: "sessionId is required" };
  }

  // Rate limit by IP + sessionId.
  const ip =
    (event.node?.req?.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ||
    event.node?.req?.socket?.remoteAddress ||
    "unknown";
  if (!rateLimit(`${ip}:${sessionId}`)) {
    setResponseStatus(event, 429);
    return { error: "Rate limit exceeded" };
  }

  const session = await getSession(event).catch(() => null);
  const sessionEmail = session?.email;
  const viewerEmail = sessionEmail ?? null;
  const viewerName = body.viewerName ?? sessionEmail?.split("@")[0] ?? null;
  const now = new Date().toISOString();

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

      // Try to find an existing row for this viewer.
      // (Using a simple scan is acceptable here — indexes are per-DB-dialect.)
      const existingRows = await db
        .select()
        .from(schema.recordingViewers)
        .where(eq(schema.recordingViewers.recordingId, recordingId));
      const existing = existingRows.find((r) => {
        if (viewerEmail) return r.viewerEmail === viewerEmail;
        return r.viewerEmail === null && r.viewerName === viewerKey;
      });

      let viewerId: string;
      let countedView = existing?.countedView ?? false;
      const newTotalWatchMs = Math.max(
        existing?.totalWatchMs ?? 0,
        Math.floor(totalWatchMs),
      );
      const newCompletedPct = Math.max(
        existing?.completedPct ?? 0,
        Math.floor(completedPct),
      );

      const meetsThreshold = shouldCountView(
        newTotalWatchMs,
        newCompletedPct,
        Boolean(scrubbedToEnd),
      );
      if (meetsThreshold) countedView = true;

      const ctaClicked =
        kind === "cta-click" ? true : (existing?.ctaClicked ?? false);

      if (existing) {
        viewerId = existing.id;
        await db
          .update(schema.recordingViewers)
          .set({
            lastViewedAt: now,
            totalWatchMs: newTotalWatchMs,
            completedPct: newCompletedPct,
            countedView,
            ctaClicked,
          })
          .where(
            and(
              eq(schema.recordingViewers.id, existing.id),
              eq(schema.recordingViewers.recordingId, recordingId),
            ),
          );
      } else {
        viewerId = nanoid();
        await db.insert(schema.recordingViewers).values({
          id: viewerId,
          recordingId,
          viewerEmail,
          viewerName: viewerEmail ? viewerName : viewerKey,
          firstViewedAt: now,
          lastViewedAt: now,
          totalWatchMs: newTotalWatchMs,
          completedPct: newCompletedPct,
          countedView,
          ctaClicked,
        });
      }

      await db.insert(schema.recordingEvents).values({
        id: nanoid(),
        recordingId,
        viewerId,
        kind,
        timestampMs: Math.max(0, Math.floor(timestampMs)),
        payload: JSON.stringify(payload ?? {}),
        createdAt: now,
      });

      // Only broadcast a refresh signal on "meaningful" events to avoid
      // spamming the polling clients every 2s with watch-progress heartbeats.
      if (kind !== "watch-progress") {
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

      return { ok: true, viewerId, countedView };
    },
  );
});
