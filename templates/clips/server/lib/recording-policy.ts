import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { getUserLabState } from "@agent-native/core/labs/server";
import { runWithRequestContext } from "@agent-native/core/server";

import {
  CLIPS_RESILIENT_RECORDING,
  CLIPS_RICH_RECORDINGS,
} from "../../shared/labs.js";
import { recordingPolicyFromLab } from "../../shared/recording-policy.js";

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
  return runWithRequestContext({ userEmail, orgId }, async () => {
    const key = richPolicyKey(recordingId);
    const saved = parseRichRecordingPolicy(await readAppState(key));
    if (saved !== null) return saved;
    const state = await getUserLabState(userEmail, CLIPS_RICH_RECORDINGS, {
      userEmail,
      orgId,
    });
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
