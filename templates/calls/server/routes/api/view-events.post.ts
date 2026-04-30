/**
 * High-frequency analytics sink for the call + snippet player.
 *
 * Body:
 *   {
 *     callId?,  snippetId?,
 *     viewerEmail?, sessionId,
 *     kind: "view-start" | "watch-progress" | "seek" | "pause" | "resume" | "reaction",
 *     timestampMs, payload?,
 *     totalWatchMs?, completedPct?, scrubbedToEnd?
 *   }
 *
 * Upserts a `call_viewers` / `snippet_viewers` row and appends to
 * `call_events`. Applies `shouldCountView` to flip `counted_view` once the
 * thresholds pass. No auth required — viewer may be anonymous.
 *
 * Rate-limited by IP + sessionId via a simple in-memory token bucket. The
 * limiter resets on restart, which is fine; this is about abuse control,
 * not metering.
 */

// guard:allow-unscoped — anonymous analytics sink. The bare existence
// check on snippets/calls is by design: the viewer may not be signed in,
// and we only need to confirm the id is real before recording analytics.
// Visibility/access is enforced upstream by the share-link / playback
// route the viewer arrived from. If you ever return resource content
// (title, body, transcript) from this endpoint, drop this marker and
// switch to `resolveAccess`.

import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../db/index.js";
import { nanoid, shouldCountView } from "../../lib/calls.js";
import { DEV_MODE_USER_EMAIL, getSession } from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";

type ViewKind =
  | "view-start"
  | "watch-progress"
  | "seek"
  | "pause"
  | "resume"
  | "reaction";

const ALLOWED_KINDS = new Set<ViewKind>([
  "view-start",
  "watch-progress",
  "seek",
  "pause",
  "resume",
  "reaction",
]);

interface ViewEventBody {
  callId?: string;
  snippetId?: string;
  kind?: ViewKind;
  timestampMs?: number;
  payload?: Record<string, unknown>;
  viewerEmail?: string;
  viewerName?: string;
  sessionId?: string;
  totalWatchMs?: number;
  completedPct?: number;
  scrubbedToEnd?: boolean;
}

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
    callId,
    snippetId,
    kind,
    timestampMs = 0,
    payload = {},
    sessionId,
    totalWatchMs = 0,
    completedPct = 0,
    scrubbedToEnd = false,
  } = body;

  if (!callId && !snippetId) {
    setResponseStatus(event, 400);
    return { error: "callId or snippetId is required" };
  }
  if (!kind || !ALLOWED_KINDS.has(kind)) {
    setResponseStatus(event, 400);
    return { error: `Invalid kind: ${kind}` };
  }
  if (!sessionId || typeof sessionId !== "string") {
    setResponseStatus(event, 400);
    return { error: "sessionId is required" };
  }

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

  const db = getDb();
  const session = await getSession(event).catch(() => null);
  const sessionEmail =
    session?.email && session.email !== DEV_MODE_USER_EMAIL
      ? session.email
      : undefined;
  // Authenticated viewers: force `viewerEmail` to the session email so a
  // body field cannot spoof someone else's identity in the analytics. For
  // anonymous viewers, ignore the body's `viewerEmail` entirely (it would
  // otherwise let one viewer poison another user's view counts) — surface
  // it only as a non-attributing display claim.
  const viewerEmail = sessionEmail ?? null;
  const claimedViewerEmail =
    !sessionEmail &&
    body.viewerEmail &&
    typeof body.viewerEmail === "string"
      ? body.viewerEmail
      : null;
  const viewerName =
    body.viewerName ??
    sessionEmail?.split("@")[0] ??
    claimedViewerEmail ??
    null;
  const now = new Date().toISOString();
  const viewerKey = viewerEmail ?? `anon:${sessionId}`;
  const boundedTotalWatchMs = Math.max(0, Math.floor(totalWatchMs));
  const boundedCompletedPct = Math.max(
    0,
    Math.min(100, Math.floor(completedPct)),
  );

  // Snippet branch — smaller surface: only the viewer row, no event log.
  if (snippetId) {
    const [snippet] = await db
      .select({
        id: schema.snippets.id,
        callId: schema.snippets.callId,
      })
      .from(schema.snippets)
      .where(eq(schema.snippets.id, snippetId))
      .limit(1);
    if (!snippet) {
      setResponseStatus(event, 404);
      return { error: "Snippet not found" };
    }

    const existingRows = await db
      .select()
      .from(schema.snippetViewers)
      .where(eq(schema.snippetViewers.snippetId, snippetId));
    const existing = existingRows.find((r) => {
      if (viewerEmail) return r.viewerEmail === viewerEmail;
      return r.viewerEmail === null && r.viewerName === viewerKey;
    });

    const newTotal = Math.max(existing?.totalWatchMs ?? 0, boundedTotalWatchMs);
    const newPct = Math.max(existing?.completedPct ?? 0, boundedCompletedPct);
    let counted = existing?.countedView ?? false;
    if (shouldCountView(newTotal, newPct, Boolean(scrubbedToEnd))) {
      counted = true;
    }

    if (existing) {
      await db
        .update(schema.snippetViewers)
        .set({
          lastViewedAt: now,
          totalWatchMs: newTotal,
          completedPct: newPct,
          countedView: counted,
        })
        .where(
          and(
            eq(schema.snippetViewers.id, existing.id),
            eq(schema.snippetViewers.snippetId, snippetId),
          ),
        );
      return { ok: true, viewerId: existing.id, countedView: counted };
    }

    const viewerId = nanoid();
    await db.insert(schema.snippetViewers).values({
      id: viewerId,
      snippetId,
      viewerEmail,
      viewerName: viewerEmail ? viewerName : viewerKey,
      firstViewedAt: now,
      lastViewedAt: now,
      totalWatchMs: newTotal,
      completedPct: newPct,
      countedView: counted,
    });
    return { ok: true, viewerId, countedView: counted };
  }

  // Call branch.
  const [call] = await db
    .select({
      id: schema.calls.id,
      visibility: schema.calls.visibility,
    })
    .from(schema.calls)
    .where(eq(schema.calls.id, callId!))
    .limit(1);
  if (!call) {
    setResponseStatus(event, 404);
    return { error: "Call not found" };
  }

  const existingRows = await db
    .select()
    .from(schema.callViewers)
    .where(eq(schema.callViewers.callId, callId!));
  const existing = existingRows.find((r) => {
    if (viewerEmail) return r.viewerEmail === viewerEmail;
    return r.viewerEmail === null && r.viewerName === viewerKey;
  });

  const newTotal = Math.max(existing?.totalWatchMs ?? 0, boundedTotalWatchMs);
  const newPct = Math.max(existing?.completedPct ?? 0, boundedCompletedPct);
  let counted = existing?.countedView ?? false;
  if (shouldCountView(newTotal, newPct, Boolean(scrubbedToEnd))) {
    counted = true;
  }

  let viewerId: string;
  if (existing) {
    viewerId = existing.id;
    await db
      .update(schema.callViewers)
      .set({
        lastViewedAt: now,
        totalWatchMs: newTotal,
        completedPct: newPct,
        countedView: counted,
      })
      .where(
        and(
          eq(schema.callViewers.id, existing.id),
          eq(schema.callViewers.callId, callId!),
        ),
      );
  } else {
    viewerId = nanoid();
    await db.insert(schema.callViewers).values({
      id: viewerId,
      callId: callId!,
      viewerEmail,
      viewerName: viewerEmail ? viewerName : viewerKey,
      firstViewedAt: now,
      lastViewedAt: now,
      totalWatchMs: newTotal,
      completedPct: newPct,
      countedView: counted,
    });
  }

  await db.insert(schema.callEvents).values({
    id: nanoid(),
    callId: callId!,
    viewerId,
    kind,
    timestampMs: Math.max(0, Math.floor(timestampMs)),
    payload: JSON.stringify(payload ?? {}),
    createdAt: now,
  });

  // Skip refresh pings on the firehose event so we don't thrash the polling
  // clients every couple of seconds.
  if (kind !== "watch-progress") {
    await writeAppState("refresh-signal", { ts: Date.now() });
  }

  return { ok: true, viewerId, countedView: counted };
});
