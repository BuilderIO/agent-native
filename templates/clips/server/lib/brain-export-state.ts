import { writeAppState } from "@agent-native/core/application-state";

export const BRAIN_EXPORT_STATE_PREFIX = "clips-brain-export-";

export type BrainExportState = {
  recordingId: string;
  status: "pending" | "exported" | "quarantined" | "failed" | "skipped";
  attempts: number;
  updatedAt: string;
  nextAttemptAt?: string;
  captureId?: string;
  sensitivityReceiptId?: string;
  sensitivityDisposition?: string;
  reason?: string;
};

export function brainExportStateKey(recordingId: string): string {
  return `${BRAIN_EXPORT_STATE_PREFIX}${recordingId}`;
}

export async function writeBrainExportState(state: BrainExportState) {
  await writeAppState(brainExportStateKey(state.recordingId), state);
}

export function parseBrainExportState(value: unknown): BrainExportState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<BrainExportState>;
  if (
    typeof state.recordingId !== "string" ||
    !state.recordingId ||
    !["pending", "exported", "quarantined", "failed", "skipped"].includes(
      String(state.status),
    ) ||
    typeof state.attempts !== "number" ||
    !Number.isInteger(state.attempts) ||
    state.attempts < 0 ||
    typeof state.updatedAt !== "string"
  ) {
    return null;
  }
  return state as BrainExportState;
}
