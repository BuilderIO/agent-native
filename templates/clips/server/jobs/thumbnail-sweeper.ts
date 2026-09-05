/**
 * thumbnail-sweeper — recurring job (every 5 min).
 *
 * Thumbnail generation is scheduled exactly once: markRecordingReady calls
 * queueReadyRecordingThumbnail (actions/finalize-recording.ts), which
 * self-HTTP-POSTs to the post-finalize worker with no try/catch around the
 * dispatch. If that self-dispatch never lands — cold start, throttling, DNS —
 * nothing ever retries and the recording is stuck without a thumbnail, which
 * silently degrades link previews (see share-meta.ts's fallback tiers).
 *
 * This sweeper recovers those stuck rows. It reuses ensureRecordingThumbnail
 * for the actual work — including its lease and retryable-status handling —
 * so this file owns none of the frame-extraction logic, only the "did this
 * fall through the cracks" scan.
 *
 * The `thumbnail_status IS NULL OR ... NOT IN ('none','failed')` half of the
 * WHERE is mandatory, not incidental: NULL is what every pre-migration row
 * (and every never-attempted row) carries, so treating NULL as "still needs a
 * thumbnail" is what lets this sweeper reach rows a status-only filter would
 * miss.
 */

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull, lt, notInArray, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ensureRecordingThumbnail } from "../lib/ensure-recording-thumbnail.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // recording must be idle 5 min
const BATCH_SIZE = 10;
let skippingLogged = false;
let running = false;

export async function runThumbnailSweepOnce(): Promise<void> {
  await runWithRequestContext({}, async () => {
    const db = getDb();
    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

    let candidates: Array<{
      id: string;
      ownerEmail: string;
      orgId: string | null;
    }>;
    try {
      // guard:allow-unscoped — background recovery scans every owner for
      // recordings whose thumbnail dispatch never landed.
      candidates = await db
        .select({
          id: schema.recordings.id,
          ownerEmail: schema.recordings.ownerEmail,
          orgId: schema.recordings.orgId,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.status, "ready"),
            isNull(schema.recordings.thumbnailUrl),
            isNull(schema.recordings.trashedAt),
            or(
              isNull(schema.recordings.thumbnailStatus),
              notInArray(schema.recordings.thumbnailStatus, ["none", "failed"]),
            ),
            lt(schema.recordings.updatedAt, staleBefore),
          ),
        )
        .limit(BATCH_SIZE);
    } catch (err: any) {
      console.warn(
        "[thumbnail-sweeper] candidate scan failed:",
        err?.message ?? err,
      );
      return;
    }

    for (const recording of candidates) {
      try {
        await runWithRequestContext(
          {
            userEmail: recording.ownerEmail,
            orgId: recording.orgId ?? undefined,
          },
          async () => {
            const result = await ensureRecordingThumbnail({
              recordingId: recording.id,
              ownerEmail: recording.ownerEmail,
            });
            console.log(
              `[thumbnail-sweeper] recovered ${recording.id}: ${result.status}`,
            );
          },
        );
      } catch (err: any) {
        console.warn(
          `[thumbnail-sweeper] failed to recover ${recording.id}:`,
          err?.message ?? err,
        );
      }
    }
  });
}

export default function registerThumbnailSweeperJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[thumbnail-sweeper] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    if (running) return;
    running = true;
    runThumbnailSweepOnce()
      .catch((err) =>
        console.error("[thumbnail-sweeper] interval failed:", err),
      )
      .finally(() => {
        running = false;
      });
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[thumbnail-sweeper] Recurring recovery sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
