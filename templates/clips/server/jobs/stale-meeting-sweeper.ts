/**
 * stale-meeting-sweeper — recurring job (every 5 min).
 *
 * Reconciles meetings stranded "live" forever by a desktop crash/force-quit
 * (actualStart set, actualEnd never stamped — see lib.rs's RunEvent::Exit
 * handler, which only kills the screencapture fallback child, never runs
 * meeting teardown). Without this, such a row keeps a permanent Live badge,
 * the detail page polls get-meeting every 2s forever, the linked recording
 * stays "uploading", and notes never generate.
 *
 * Staleness definition (conservative — never end a genuinely live meeting):
 *   - actualStart IS NOT NULL AND actualEnd IS NULL AND trashedAt IS NULL
 *   - last transcript activity (recording_transcripts.updatedAt, or
 *     meetings.updatedAt if no transcript row) is older than
 *     STALE_THRESHOLD_MS — the desktop flushes the transcript at least every
 *     1.5s while genuinely live, so this many minutes of silence is
 *     decisive.
 *   - scheduledEnd IS NULL OR scheduledEnd < now — if the scheduled window
 *     is still in the future, skip: the user may have simply paused.
 *
 * Mirrors what `actions/stop-meeting-recording.ts` does when a user
 * manually stops (kept as a small duplicated helper here rather than
 * importing that action file, which is outside this slice's ownership):
 * stamp actualEnd, flip transcriptStatus to 'ready'/'failed' based on
 * whether transcript text exists, and flip the linked recording out of
 * 'uploading'. Exported so `actions/delete-meeting.ts` can reuse the same
 * close-out logic when trashing a meeting that's still live.
 *
 * A second, independent pass (`sweepStalePendingFinalizes`) reconciles
 * meetings stranded in transcriptStatus='pending' by a server crash
 * mid-finalize. This predicate deliberately does not require `actualEnd IS
 * NULL`: a meeting reaching the finalize CAS already has `actualEnd` stamped,
 * so gating on live-meeting shape would never match. Restoring to 'failed'
 * unblocks both manual "Regenerate notes" and an ordinary finalize retry.
 */

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import finalizeMeeting from "../../actions/finalize-meeting.js";
import { getDb, schema } from "../db/index.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 min of zero transcript activity
// A finalize claim with no update in this long is presumed crashed, not merely
// a slow Gemini call. Mirrors finalize-meeting.ts's force-takeover window.
const PENDING_STALE_MS = 2 * 60 * 1000; // 2 min
let skippingLogged = false;

/**
 * Close out a single stranded-live meeting row: stamp actualEnd, set
 * transcriptStatus based on transcript presence, and flip a still-uploading
 * linked recording to ready. Shared by the sweeper and by delete-meeting
 * (trashing a live meeting should stop it the same way).
 */
export async function closeOutStaleMeeting(args: {
  meetingId: string;
  recordingId: string | null;
  ownerEmail: string;
  orgId: string | null;
  /** Estimated end timestamp — pass the transcript's last updatedAt when
   * available so actualEnd reflects when activity actually stopped, not
   * "now" (which could be hours after the crash). */
  endedAtIso?: string;
}): Promise<{ hasTranscript: boolean }> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  let hasTranscript = false;
  if (args.recordingId) {
    const [transcript] = await db
      .select({ fullText: schema.recordingTranscripts.fullText })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, args.recordingId))
      .limit(1);
    hasTranscript = Boolean(transcript?.fullText?.trim());
  }

  const meetingOwnershipScope = args.orgId
    ? and(
        eq(schema.meetings.ownerEmail, args.ownerEmail),
        eq(schema.meetings.orgId, args.orgId),
      )
    : and(
        eq(schema.meetings.ownerEmail, args.ownerEmail),
        isNull(schema.meetings.orgId),
      );

  await db
    .update(schema.meetings)
    .set({
      actualEnd: args.endedAtIso ?? nowIso,
      updatedAt: nowIso,
      transcriptStatus: hasTranscript ? "ready" : "failed",
    })
    .where(and(eq(schema.meetings.id, args.meetingId), meetingOwnershipScope));

  if (args.recordingId) {
    const recordingOwnershipScope = args.orgId
      ? and(
          eq(schema.recordings.ownerEmail, args.ownerEmail),
          eq(schema.recordings.orgId, args.orgId),
        )
      : and(
          eq(schema.recordings.ownerEmail, args.ownerEmail),
          isNull(schema.recordings.orgId),
        );

    await db
      .update(schema.recordings)
      .set({ status: "ready", updatedAt: nowIso })
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          eq(schema.recordings.status, "uploading"),
          recordingOwnershipScope,
        ),
      );
  }

  return { hasTranscript };
}

/**
 * Restore any meeting stuck in transcriptStatus='pending' for longer than
 * PENDING_STALE_MS back to 'failed'. Deliberately independent of `actualEnd`
 * because meetings reach the finalize CAS only after `actualEnd` is already
 * stamped. CAS-guarded on transcriptStatus='pending' so this can't race a
 * finalize call that completes concurrently.
 */
async function sweepStalePendingFinalizes(db: ReturnType<typeof getDb>) {
  const staleBefore = new Date(Date.now() - PENDING_STALE_MS).toISOString();
  // guard:allow-unscoped — background recovery scans all owners for crash-stranded finalize claims.
  const stuck = await db
    .select({ id: schema.meetings.id, updatedAt: schema.meetings.updatedAt })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.transcriptStatus, "pending"),
        lt(schema.meetings.updatedAt, staleBefore),
      ),
    );

  for (const meeting of stuck) {
    try {
      const nowIso = new Date().toISOString();
      const restored = await db
        .update(schema.meetings)
        .set({ transcriptStatus: "failed", updatedAt: nowIso })
        .where(
          and(
            eq(schema.meetings.id, meeting.id),
            eq(schema.meetings.transcriptStatus, "pending"),
          ),
        )
        .returning({ id: schema.meetings.id });
      if (restored.length) {
        console.log(
          `[stale-meeting-sweeper] restored crash-stranded pending finalize ${meeting.id} (stuck since ${meeting.updatedAt})`,
        );
      }
    } catch (err: any) {
      console.warn(
        `[stale-meeting-sweeper] failed to restore stuck-pending ${meeting.id}:`,
        err?.message ?? err,
      );
    }
  }
}

export async function runStaleMeetingSweepOnce(): Promise<void> {
  await runWithRequestContext({}, async () => {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const staleBefore = new Date(
      now.getTime() - STALE_THRESHOLD_MS,
    ).toISOString();

    try {
      const candidates = await db
        .select({
          id: schema.meetings.id,
          recordingId: schema.meetings.recordingId,
          ownerEmail: schema.meetings.ownerEmail,
          orgId: schema.meetings.orgId,
          updatedAt: schema.meetings.updatedAt,
          scheduledEnd: schema.meetings.scheduledEnd,
        })
        .from(schema.meetings)
        .where(
          and(
            isNotNull(schema.meetings.actualStart),
            isNull(schema.meetings.actualEnd),
            isNull(schema.meetings.trashedAt),
            or(
              isNull(schema.meetings.scheduledEnd),
              lt(schema.meetings.scheduledEnd, nowIso),
            ),
          ),
        );

      for (const meeting of candidates) {
        try {
          let lastActivityIso = meeting.updatedAt;
          if (meeting.recordingId) {
            const [transcript] = await db
              .select({ updatedAt: schema.recordingTranscripts.updatedAt })
              .from(schema.recordingTranscripts)
              .where(
                eq(
                  schema.recordingTranscripts.recordingId,
                  meeting.recordingId,
                ),
              )
              .limit(1);
            if (transcript?.updatedAt) lastActivityIso = transcript.updatedAt;
          }
          if (!lastActivityIso || lastActivityIso > staleBefore) continue;

          const closed = await closeOutStaleMeeting({
            meetingId: meeting.id,
            recordingId: meeting.recordingId,
            ownerEmail: meeting.ownerEmail,
            orgId: meeting.orgId,
            endedAtIso: lastActivityIso,
          });
          if (closed.hasTranscript) {
            try {
              await runWithRequestContext(
                {
                  userEmail: meeting.ownerEmail,
                  orgId: meeting.orgId ?? undefined,
                },
                async () => {
                  await finalizeMeeting.run({ meetingId: meeting.id });
                },
              );
            } catch (err: any) {
              console.warn(
                `[stale-meeting-sweeper] failed to finalize recovered meeting ${meeting.id}:`,
                err?.message ?? err,
              );
            }
          }
          console.log(
            `[stale-meeting-sweeper] closed out stranded-live meeting ${meeting.id} (last activity ${lastActivityIso})`,
          );
        } catch (err: any) {
          console.warn(
            `[stale-meeting-sweeper] failed to close out ${meeting.id}:`,
            err?.message ?? err,
          );
        }
      }
    } catch (err: any) {
      // Best-effort — must never crash the host process.
      console.warn(`[stale-meeting-sweeper] tick failed:`, err?.message ?? err);
    }

    try {
      await sweepStalePendingFinalizes(db);
    } catch (err: any) {
      // Best-effort — must never crash the host process.
      console.warn(
        `[stale-meeting-sweeper] pending-finalize sweep failed:`,
        err?.message ?? err,
      );
    }
  });
}

export default function registerStaleMeetingSweeperJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[stale-meeting-sweeper] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    runStaleMeetingSweepOnce().catch((err) =>
      console.error("[stale-meeting-sweeper] interval failed:", err),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[stale-meeting-sweeper] Recurring stale-meeting reconciliation every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
