export interface FinalizeReceipt {
  ok?: unknown;
  finalized?: unknown;
  status?: unknown;
  sourceSizeBytes?: unknown;
  durationMs?: unknown;
}

export interface LocalRecordingProof {
  bytes: number;
  durationMs: number;
}

export function verifyFinalizeReceipt(
  receipt: FinalizeReceipt | null,
  local: LocalRecordingProof,
): void {
  if (
    !receipt ||
    receipt.ok !== true ||
    receipt.finalized !== true ||
    receipt.status !== "ready"
  ) {
    throw new Error(
      "Clip may be incomplete. Finalization was not confirmed; the local backup was kept.",
    );
  }

  const sourceSizeBytes = Number(receipt.sourceSizeBytes);
  if (
    !Number.isFinite(sourceSizeBytes) ||
    sourceSizeBytes <= 0 ||
    sourceSizeBytes !== local.bytes
  ) {
    throw new Error(
      `Clip may be incomplete. The server confirmed ${Number.isFinite(sourceSizeBytes) ? sourceSizeBytes : "an unknown number of"} of ${local.bytes} source bytes; the local backup was kept.`,
    );
  }

  const durationMs = Number(receipt.durationMs);
  const toleranceMs = Math.max(5_000, local.durationMs * 0.02);
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    Math.abs(durationMs - local.durationMs) > toleranceMs
  ) {
    throw new Error(
      "Clip may be incomplete. The uploaded duration did not match the local recording; the local backup was kept.",
    );
  }
}
