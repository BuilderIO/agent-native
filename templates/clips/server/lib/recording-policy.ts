import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { getUserLabState } from "@agent-native/core/labs/server";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";

import {
  CLIPS_RESILIENT_RECORDING,
  CLIPS_RICH_RECORDINGS,
} from "../../shared/labs.js";
import { recordingPolicyFromLab } from "../../shared/recording-policy.js";
import type { CleanupTransaction } from "./recording-media-lifecycle.js";

async function getRecordingLabPolicy(userEmail: string, orgId?: string) {
  const state = await getUserLabState(userEmail, CLIPS_RESILIENT_RECORDING, {
    userEmail,
    orgId,
  });
  return { source: state.source, policy: recordingPolicyFromLab(state) };
}

function uploadPolicyKey(recordingId: string): string {
  return `recording-recovery-policy-${recordingId}`;
}

function parseUploadRecoveryPolicy(
  value: Record<string, unknown> | null,
): boolean | null {
  if (value === null) return null;
  if (value.version !== 1 || typeof value.recovery !== "boolean") {
    throw new Error("Stored recording recovery policy is unreadable.");
  }
  return value.recovery;
}

export async function getUploadRecoveryPolicy(
  userEmail: string,
  orgId: string | undefined,
  recordingId: string,
): Promise<boolean> {
  return runWithRequestContext({ userEmail, orgId }, async () => {
    const saved = parseUploadRecoveryPolicy(
      await readAppState(uploadPolicyKey(recordingId)),
    );
    if (saved !== null) return saved;
    const { source, policy } = await getRecordingLabPolicy(userEmail, orgId);
    // A retry without a snapshot began before this version recorded policy.
    // An explicit Off must not revoke that already-created upload.
    return source === "choice" && !policy.recovery ? true : policy.recovery;
  });
}

export async function snapshotUploadRecoveryPolicy(
  userEmail: string,
  orgId: string | undefined,
  recordingId: string,
  preserveExistingWork = false,
): Promise<boolean> {
  return runWithRequestContext({ userEmail, orgId }, async () => {
    const key = uploadPolicyKey(recordingId);
    const saved = parseUploadRecoveryPolicy(await readAppState(key));
    if (saved !== null) return saved;
    const { source, policy } = await getRecordingLabPolicy(userEmail, orgId);
    const recovery =
      preserveExistingWork && source === "choice" && !policy.recovery
        ? true
        : policy.recovery;
    if (await compareAndSetAppState(key, null, { version: 1, recovery })) {
      return recovery;
    }
    const winner = parseUploadRecoveryPolicy(await readAppState(key));
    if (winner === null)
      throw new Error(
        "Recording recovery policy changed before it could be saved.",
      );
    return winner;
  });
}

function richPolicyKey(recordingId: string): string {
  return `recording-rich-policy-${recordingId}`;
}

function parseRichRecordingPolicy(
  value: Record<string, unknown> | null,
): boolean | null {
  if (value === null) return null;
  if (value.version !== 1 || typeof value.rich !== "boolean") {
    throw new Error("Stored rich recording policy is unreadable.");
  }
  return value.rich;
}

/**
 * Whether this recording keeps separate tracks, decided by the owner's
 * "Rich recordings" lab the first time a track arrives and then fixed, so
 * turning the lab off mid-recording can't strand half a rich recording.
 */
export async function snapshotRichRecordingPolicy(
  userEmail: string,
  orgId: string | undefined,
  recordingId: string,
): Promise<boolean> {
  const scope = orgId === undefined ? { userEmail } : { userEmail, orgId };
  return runWithRequestContext(scope, async () => {
    const key = richPolicyKey(recordingId);
    const saved = parseRichRecordingPolicy(await readAppState(key));
    if (saved !== null) return saved;
    const state = await getUserLabState(
      userEmail,
      CLIPS_RICH_RECORDINGS,
      scope,
    );
    if (
      await compareAndSetAppState(key, null, {
        version: 1,
        rich: state.enabled,
      })
    ) {
      return state.enabled;
    }
    const winner = parseRichRecordingPolicy(await readAppState(key));
    if (winner === null)
      throw new Error(
        "Rich recording policy changed before it could be saved.",
      );
    return winner;
  });
}

/**
 * Stops a recording keeping separate tracks, for good: its track uploads and
 * finalize are refused from then on. A burn calls this before it swaps the
 * video, so a track it can't delete can't be finalized again once the owner
 * clears the marks that held the clip.
 */
export async function stopRichRecording(
  ownerEmail: string,
  recordingId: string,
): Promise<void> {
  // Saved as the owner, whose uploads read it; an editor can run the burn.
  await runWithRequestContext(
    { userEmail: ownerEmail.trim().toLowerCase() },
    () =>
      writeAppState(richPolicyKey(recordingId), { version: 1, rich: false }),
  );
}

const appStateTable = pgTable("application_state", {
  sessionId: text("session_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
});

/**
 * Whether the recording was stopped keeping tracks, read in the caller's
 * transaction. A burn saves the stop before it changes the recording's row,
 * so a transaction that locks the row after the owner clears the marks again
 * still sees it.
 */
export async function richRecordingStopped(
  tx: CleanupTransaction,
  ownerEmail: string,
  recordingId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ value: appStateTable.value })
    .from(appStateTable)
    .where(
      and(
        eq(appStateTable.sessionId, ownerEmail.trim().toLowerCase()),
        eq(appStateTable.key, richPolicyKey(recordingId)),
      ),
    )
    .limit(1);
  const row = rows.length ? rows[0] : null;
  if (!row) return false;
  const saved = JSON.parse(row.value) as Record<string, unknown> | null;
  return parseRichRecordingPolicy(saved) === false;
}
