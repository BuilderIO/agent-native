/** Site-wide Blobs store; `@netlify/blobs` names it `site:<name>` on the wire. */
export const NETLIFY_WAKE_MARKER_STORE = "agent-native-recurring-jobs";
export const NETLIFY_WAKE_MARKER_IDLE_KEY = "idle";
export const NETLIFY_WAKE_MARKER_ACTIVITY_KEY = "activity";

/**
 * The longest an idle app goes without a sweep, in minutes. App sweep handlers
 * (calendar rules, cleanups, webhook retries) and paused-automation probes have
 * no due time the marker can see, so they run at least this often. `0` turns
 * idle skipping off and sweeps every minute.
 */
export const IDLE_SWEEP_MAX_MINUTES_ENV_VAR =
  "AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES";
export const DEFAULT_IDLE_SWEEP_MAX_MINUTES = 60;
export const MAX_IDLE_SWEEP_MAX_MINUTES = 24 * 60;

/**
 * How long after the last request the sweep keeps its minute cadence. Work a
 * visitor starts (queued submissions, trigger queues, follow-ups) lands within
 * a few sweeps, and the database is awake for the visit anyway.
 */
export const IDLE_AFTER_ACTIVITY_MS = 10 * 60_000;

const ACTIVITY_MARK_INTERVAL_MS = 60_000;
/**
 * Each marker read or write gives up after this long. Two instances' activity
 * writes can only overlap within it, so a later mark overwritten by an earlier
 * one moves the recorded visit back by at most this much.
 */
export const NETLIFY_WAKE_MARKER_IO_TIMEOUT_MS = 5_000;
const MARKER_IO_TIMEOUT_MS = NETLIFY_WAKE_MARKER_IO_TIMEOUT_MS;
const DEFAULT_ACTIVITY_WRITE_RETRY_DELAYS_MS = [1_000, 3_000];
let activityWriteRetryDelaysMs = DEFAULT_ACTIVITY_WRITE_RETRY_DELAYS_MS;

export interface NetlifyIdleMarker {
  /** Epoch ms before which the scheduled function skips the sweep. */
  sweepAfter: number;
  /**
   * Epoch ms when the deciding sweep started. A request marked at or after it
   * may have changed what is due, so the scheduled function sweeps again.
   */
  decidedAt: number;
}

export interface NetlifyActivityMarker {
  at: number;
}

interface NetlifyBlobsContext {
  siteID: string;
  token: string;
  edgeURL: string;
  uncachedEdgeURL?: string;
}

export function resolveIdleSweepMaxMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[IDLE_SWEEP_MAX_MINUTES_ENV_VAR]?.trim();
  const minutes = raw ? Number(raw) : NaN;
  if (!Number.isFinite(minutes) || minutes < 0) {
    return DEFAULT_IDLE_SWEEP_MAX_MINUTES * 60_000;
  }
  return Math.min(minutes, MAX_IDLE_SWEEP_MAX_MINUTES) * 60_000;
}

/**
 * The context Netlify's function runtime hands `@netlify/blobs`. Only the edge
 * endpoint is supported: deployed functions always get one, and a missing
 * context leaves the scheduled function sweeping every minute.
 */
export function readNetlifyBlobsContext(): NetlifyBlobsContext | null {
  const raw =
    (globalThis as { netlifyBlobsContext?: unknown }).netlifyBlobsContext ??
    process.env.NETLIFY_BLOBS_CONTEXT;
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64").toString("utf8"),
    ) as Partial<NetlifyBlobsContext> | null;
    if (!parsed?.siteID || !parsed.token || !parsed.edgeURL) return null;
    return {
      siteID: parsed.siteID,
      token: parsed.token,
      edgeURL: parsed.edgeURL,
      ...(parsed.uncachedEdgeURL
        ? { uncachedEdgeURL: parsed.uncachedEdgeURL }
        : {}),
    };
  } catch (error) {
    console.warn(
      "[recurring-jobs] NETLIFY_BLOBS_CONTEXT is unreadable; the sweep stays on its minute cadence:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function markerUrl(
  context: NetlifyBlobsContext,
  key: string,
  consistency: "strong" | "eventual",
): string {
  const base =
    consistency === "strong" ? context.uncachedEdgeURL : context.edgeURL;
  if (!base) {
    throw new Error("The Netlify Blobs context has no uncached edge URL.");
  }
  return new URL(
    `/${context.siteID}/site:${NETLIFY_WAKE_MARKER_STORE}/${key}`,
    base,
  ).toString();
}

export async function readNetlifyWakeMarker<T>(
  key: string,
  context: NetlifyBlobsContext,
): Promise<T | null> {
  const response = await fetch(markerUrl(context, key, "strong"), {
    headers: { authorization: `Bearer ${context.token}` },
    signal: AbortSignal.timeout(MARKER_IO_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Netlify Blobs read of "${key}" failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

export async function writeNetlifyWakeMarker(
  key: string,
  value: NetlifyIdleMarker | NetlifyActivityMarker,
  context: NetlifyBlobsContext,
): Promise<void> {
  const response = await fetch(markerUrl(context, key, "eventual"), {
    method: "PUT",
    headers: {
      authorization: `Bearer ${context.token}`,
      "cache-control": "max-age=0, stale-while-revalidate=60",
    },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(MARKER_IO_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Netlify Blobs write of "${key}" failed (${response.status})`,
    );
  }
}

/**
 * When the next sweep is needed. A sweep that found work, a recent visitor, or
 * idle skipping turned off keeps the minute cadence by answering `now`.
 */
export function decideIdleSweepAfter(input: {
  now: number;
  busy: boolean;
  lastActivityAt: number | null;
  nextDueAt: number | null;
  maxIdleMs: number;
}): number {
  const { now, maxIdleMs } = input;
  if (input.busy || maxIdleMs <= 0) return now;
  if (
    input.lastActivityAt !== null &&
    now - input.lastActivityAt < IDLE_AFTER_ACTIVITY_MS
  ) {
    return now;
  }
  const cap = now + maxIdleMs;
  if (input.nextDueAt === null) return cap;
  return Math.max(now, Math.min(cap, input.nextDueAt));
}

/**
 * Records a completed sweep's verdict. Never throws: on any failure the old
 * marker stays, and the worst case is the minute cadence this replaced. A sweep
 * that started before the one behind the current marker replaces it only with
 * a sooner wake, so an overlapping sweep can't push a newer verdict back, and a
 * sweep that found work is never ignored.
 */
export async function recordNetlifySweepOutcome(input: {
  startedAt: number;
  busy: boolean;
  nextDueAt: number | null;
  now?: number;
}): Promise<NetlifyIdleMarker | null> {
  const context = readNetlifyBlobsContext();
  if (!context) return null;
  try {
    const now = input.now ?? Date.now();
    const current = await readNetlifyWakeMarker<Partial<NetlifyIdleMarker>>(
      NETLIFY_WAKE_MARKER_IDLE_KEY,
      context,
    );
    const activity = await readNetlifyWakeMarker<NetlifyActivityMarker>(
      NETLIFY_WAKE_MARKER_ACTIVITY_KEY,
      context,
    );
    const lastActivityAt =
      typeof activity?.at === "number" && Number.isFinite(activity.at)
        ? activity.at
        : null;
    const marker: NetlifyIdleMarker = {
      sweepAfter: decideIdleSweepAfter({
        now,
        busy: input.busy,
        lastActivityAt,
        nextDueAt: input.nextDueAt,
        maxIdleMs: resolveIdleSweepMaxMs(),
      }),
      decidedAt: input.startedAt,
    };
    const currentDecidedAt = current?.decidedAt;
    const currentSweepAfter = current?.sweepAfter;
    if (
      typeof currentDecidedAt === "number" &&
      typeof currentSweepAfter === "number" &&
      currentDecidedAt > input.startedAt &&
      currentDecidedAt <= now &&
      currentSweepAfter <= marker.sweepAfter
    ) {
      return null;
    }
    await writeNetlifyWakeMarker(NETLIFY_WAKE_MARKER_IDLE_KEY, marker, context);
    if (marker.sweepAfter > now) {
      console.log(
        `[recurring-jobs] App is idle; the next sweep runs at ${new Date(marker.sweepAfter).toISOString()} unless a request comes first.`,
      );
    }
    return marker;
  } catch (error) {
    console.warn(
      "[recurring-jobs] Could not record the idle marker; the sweep stays on its minute cadence:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

let lastActivityMarkAt = 0;

export function __resetNetlifyActivityMarkForTests(
  retryDelaysMs: number[] = [0, 0],
): void {
  lastActivityMarkAt = 0;
  activityWriteRetryDelaysMs = retryDelaysMs;
}

async function writeActivityMarker(
  now: number,
  context: NetlifyBlobsContext,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeNetlifyWakeMarker(
        NETLIFY_WAKE_MARKER_ACTIVITY_KEY,
        { at: now },
        context,
      );
      return;
    } catch (error) {
      if (attempt >= activityWriteRetryDelaysMs.length) throw error;
      const delayMs = activityWriteRetryDelaysMs[attempt];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Tells the scheduled function a visitor is here, at most once a minute per
 * server instance. The first request after a quiet period always writes: the
 * sweep only goes idle ten minutes after the last mark. A failed write is
 * retried after 1 and 3 seconds, then left for the next request: a lost mark
 * can leave the scheduled function trusting an idle verdict decided before
 * the visit, and sleeping past work the visit scheduled.
 */
export function markNetlifyAppActivity(
  now: number = Date.now(),
): Promise<void> | null {
  if (now - lastActivityMarkAt < ACTIVITY_MARK_INTERVAL_MS) return null;
  const context = readNetlifyBlobsContext();
  if (!context) return null;
  lastActivityMarkAt = now;
  return writeActivityMarker(now, context).catch((error: unknown) => {
    if (lastActivityMarkAt === now) lastActivityMarkAt = 0;
    console.warn(
      "[recurring-jobs] Could not mark request activity for the idle sweep:",
      error instanceof Error ? error.message : error,
    );
  });
}
