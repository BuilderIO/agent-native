import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";

import finalizeRecording from "../../actions/finalize-recording.js";
import { getDb, schema } from "../db/index.js";
import {
  MEDIA_VERIFICATION_STATE_PREFIX,
  parseMediaVerificationMarker,
} from "../lib/media-verification-state.js";
import { ownerEmailMatches } from "../lib/recordings.js";

const SWEEP_INTERVAL_MS = 60_000;
const DISPATCH_FALLBACK_GRACE_MS = 30_000;
const MAX_ATTEMPTS = 10;
let skippingLogged = false;

export async function runMediaVerificationSweepOnce(): Promise<void> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT session_id, key, value FROM application_state WHERE key LIKE ?`,
    args: [`${MEDIA_VERIFICATION_STATE_PREFIX}%`],
  });
  const now = Date.now();

  for (const row of rows as Array<{
    session_id?: unknown;
    key?: unknown;
    value?: unknown;
  }>) {
    const sessionId =
      typeof row.session_id === "string" ? row.session_id.trim() : "";
    const key = typeof row.key === "string" ? row.key : "";
    const recordingId = key.startsWith(MEDIA_VERIFICATION_STATE_PREFIX)
      ? key.slice(MEDIA_VERIFICATION_STATE_PREFIX.length)
      : "";
    const rawValue = typeof row.value === "string" ? row.value : "";
    let rawState: unknown;
    try {
      rawState = JSON.parse(rawValue);
    } catch {
      continue;
    }
    const marker = parseMediaVerificationMarker(rawState);
    if (
      !sessionId ||
      !recordingId ||
      !marker ||
      marker.recordingId !== recordingId
    ) {
      continue;
    }

    const nextAttemptAt = Date.parse(marker.nextAttemptAt);
    const leaseUntil = marker.leaseUntil
      ? Date.parse(marker.leaseUntil)
      : Number.NEGATIVE_INFINITY;
    const due =
      marker.status === "pending"
        ? now >= nextAttemptAt + DISPATCH_FALLBACK_GRACE_MS
        : now >= leaseUntil;
    if (marker.completedAttempts >= MAX_ATTEMPTS || !due) {
      continue;
    }

    try {
      const [recording] = await getDb()
        .select({
          ownerEmail: schema.recordings.ownerEmail,
          orgId: schema.recordings.orgId,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, sessionId),
            eq(schema.recordings.status, "processing"),
            isNull(schema.recordings.trashedAt),
          ),
        )
        .limit(1);
      if (!recording) continue;

      await runWithRequestContext(
        {
          userEmail: recording.ownerEmail,
          orgId: recording.orgId ?? undefined,
        },
        async () => {
          await finalizeRecording.run({
            id: recordingId,
            mediaVerificationRetryAttempt: Math.min(
              MAX_ATTEMPTS,
              marker.completedAttempts + 1,
            ),
          });
        },
      );
    } catch (err) {
      console.warn("[media-verification] sweep item failed", {
        key: String(row.key ?? ""),
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export default function registerMediaVerificationJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[media-verification] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    runMediaVerificationSweepOnce().catch((err) =>
      console.error("[media-verification] interval failed:", err),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[media-verification] Recurring recovery sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
