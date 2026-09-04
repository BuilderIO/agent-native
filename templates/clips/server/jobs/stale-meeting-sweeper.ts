/**
 * stale-meeting-sweeper — recurring job (every 5 min).
 *
 * Reconciles meetings stranded "live" forever by a desktop crash/force-quit
 * (actualStart set, actualEnd never stamped — see lib.rs's RunEvent::Exit
 * handler, which only kills the screencapture fallback child, never runs
 * meeting teardown). Without this, such a row keeps a permanent Live badge,
 * the detail page polls get-meeting every 2s forever, the linked recording
 * stays "uploading", and notes never generate. It is also the only server
 * backstop for the native end-of-call detector missing a real hangup — the
 * calendar-end and 15-min silence watchers are cross-platform, only the mic-
 * release and sleep watchers are macOS-only.
 *
 * Three independent staleness predicates close out a live meeting — any one
 * is sufficient:
 *
 *   1. No-activity: last transcript activity (recording_transcripts.updatedAt,
 *      or meetings.updatedAt if no transcript row) is older than
 *      STALE_THRESHOLD_MS — the desktop flushes the transcript at least every
 *      1.5s while genuinely live, so this many minutes of silence is
 *      decisive.
 *   2. Time-bound + short inactivity: closes a meeting well past its expected
 *      end once activity has been quiet for at least TIME_BOUND_INACTIVITY_MS
 *      — short enough that a burst of post-call ambient noise (fans, a TV,
 *      someone else's voice) can't keep re-flushing `updatedAt` and disarm
 *      predicate 1 forever, but long enough that a real meeting still
 *      actively transcribing past its slot (running long) is left alone.
 *        - scheduledEnd is set: now > scheduledEnd + SCHEDULED_END_GRACE_MS
 *          AND lastActivity older than TIME_BOUND_INACTIVITY_MS.
 *        - scheduledEnd is null (ad-hoc meeting, no calendar bound):
 *          now > actualStart + ADHOC_MAX_SESSION_MS AND lastActivity older
 *          than TIME_BOUND_INACTIVITY_MS.
 *   3. Hard cap: unconditional, ignores activity entirely — a runaway session
 *      (constant ambient noise defeats predicate 2 forever too) still ends
 *      after ADHOC_HARD_CAP_MS past its anchor (scheduledEnd, or actualStart
 *      for ad-hoc meetings). Generous on purpose: this is the backstop for
 *      the backstop, not the common case.
 *
 * All three predicates only apply once actualStart IS NOT NULL AND actualEnd
 * IS NULL AND trashedAt IS NULL — never end a meeting still genuinely live.
 * If scheduledEnd is still in the future, skip: the user may have simply
 * paused, and an hour without a transcript line inside the scheduled block
 * is not proof the call ended (transcription can fail while a call runs).
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
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import finalizeMeeting from "../../actions/finalize-meeting.js";
import { getDb, schema } from "../db/index.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 min of zero transcript activity
// Scheduled meetings: eligible for time-bound closure this long past
// scheduledEnd (still gated on TIME_BOUND_INACTIVITY_MS below).
const SCHEDULED_END_GRACE_MS = 20 * 60 * 1000; // 20 min
// Ad-hoc meetings (no scheduledEnd) have no calendar time bound, so cap the
// session length outright (also gated on TIME_BOUND_INACTIVITY_MS below).
const ADHOC_MAX_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours
// Predicate 2's activity gate — short on purpose. A meeting still genuinely
// live and overrunning its slot keeps flushing transcript activity far more
// often than this, so requiring silence this recent (rather than reusing the
// 60-min STALE_THRESHOLD_MS) is what stops predicate 2 from truncating a real
// overrunning call. Long enough to not fire on a single flush cycle's jitter.
const TIME_BOUND_INACTIVITY_MS = 5 * 60 * 1000; // 5 min
// Predicate 3 — unconditional, no activity check. Anchors on scheduledEnd for
// scheduled meetings, actualStart for ad-hoc.
const ADHOC_HARD_CAP_MS = 12 * 60 * 60 * 1000; // 12 hours
// A finalize claim with no update in this long is presumed crashed, not merely
// a slow Gemini call. Mirrors finalize-meeting.ts's force-takeover window.
const PENDING_STALE_MS = 2 * 60 * 1000; // 2 min
let skippingLogged = false;
let running = false;

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
  /** Which predicate closed this meeting, e.g. "sweeper:no-activity". Omit
   * to leave end_reason untouched (delete-meeting's reuse of this helper
   * isn't a sweeper predicate, so it has no reason to stamp). */
  endReason?: string;
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

  // First writer wins, in SQL: a stop that lands between the candidate query
  // and this update (desktop detector, manual click, delete-meeting reusing
  // this helper) keeps its end time, and the cause rides that same actual_end
  // transition so this closer cannot claim an end it did not perform. A
  // finalizer's in-flight "pending" claim is never reset.
  const transcriptStatus = hasTranscript ? "ready" : "failed";
  await db
    .update(schema.meetings)
    .set({
      actualEnd: sql`coalesce(${schema.meetings.actualEnd}, ${args.endedAtIso ?? nowIso})`,
      updatedAt: nowIso,
      transcriptStatus: sql`case when ${schema.meetings.transcriptStatus} = 'pending' then ${schema.meetings.transcriptStatus} else ${transcriptStatus} end`,
      ...(args.endReason
        ? {
            endReason: sql`case when ${schema.meetings.actualEnd} is null then ${args.endReason} else ${schema.meetings.endReason} end`,
          }
        : {}),
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
    const timeBoundInactiveBefore = new Date(
      now.getTime() - TIME_BOUND_INACTIVITY_MS,
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
          actualStart: schema.meetings.actualStart,
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
          const noActivityStale =
            Boolean(lastActivityIso) && lastActivityIso <= staleBefore;
          const timeBoundInactive =
            Boolean(lastActivityIso) &&
            lastActivityIso <= timeBoundInactiveBefore;

          // Predicate 2 (time-bound + short inactivity) and predicate 3 (hard
          // cap, unconditional) share an anchor: scheduledEnd when set,
          // otherwise actualStart for ad-hoc meetings.
          let timeBoundStale = false;
          let hardCapStale = false;
          const anchor = meeting.scheduledEnd ?? meeting.actualStart;
          if (anchor) {
            const anchorMs = new Date(anchor).getTime();
            hardCapStale = now.getTime() > anchorMs + ADHOC_HARD_CAP_MS;
            const graceMs = meeting.scheduledEnd
              ? SCHEDULED_END_GRACE_MS
              : ADHOC_MAX_SESSION_MS;
            timeBoundStale =
              now.getTime() > anchorMs + graceMs && timeBoundInactive;
          }

          if (!noActivityStale && !timeBoundStale && !hardCapStale) continue;

          const reason = hardCapStale
            ? "hard-cap"
            : timeBoundStale
              ? meeting.scheduledEnd
                ? "scheduled-end-grace"
                : "adhoc-max-session"
              : "no-transcript-activity";
          console.info("[stale-meeting-sweeper] closing stale meeting", {
            meetingId: meeting.id,
            reason,
            noActivityStale,
            timeBoundStale,
            hardCapStale,
            lastActivityIso,
            scheduledEnd: meeting.scheduledEnd,
            actualStart: meeting.actualStart,
          });

          const closed = await closeOutStaleMeeting({
            meetingId: meeting.id,
            recordingId: meeting.recordingId,
            ownerEmail: meeting.ownerEmail,
            orgId: meeting.orgId,
            endedAtIso: lastActivityIso || nowIso,
            endReason: `sweeper:${reason}`,
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
            `[stale-meeting-sweeper] closed out stranded-live meeting ${meeting.id} (reason ${reason}, last activity ${lastActivityIso})`,
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
    if (running) return;
    running = true;
    runStaleMeetingSweepOnce()
      .catch((err) =>
        console.error("[stale-meeting-sweeper] interval failed:", err),
      )
      .finally(() => {
        running = false;
      });
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[stale-meeting-sweeper] Recurring stale-meeting reconciliation every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
