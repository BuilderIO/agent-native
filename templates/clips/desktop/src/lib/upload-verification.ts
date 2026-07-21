export interface FinalizeReceipt {
  ok?: unknown;
  finalized?: unknown;
  status?: unknown;
  verificationPending?: unknown;
  sourceSizeBytes?: unknown;
  durationMs?: unknown;
}

export interface LocalRecordingProof {
  bytes: number;
  durationMs: number;
}

export type FinalizeReceiptStatus = "processing" | "ready";

export function parseFinalizeReceipt(body: string): FinalizeReceipt | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object"
      ? (parsed as FinalizeReceipt)
      : null;
  } catch {
    throw new Error("Upload returned an invalid finalization response");
  }
}

export function verifyFinalizeReceipt(
  receipt: FinalizeReceipt | null,
  local: LocalRecordingProof,
): FinalizeReceiptStatus {
  const ready =
    receipt?.ok === true &&
    receipt.finalized === true &&
    receipt.status === "ready";
  const processing =
    receipt?.ok === true &&
    receipt.finalized === false &&
    receipt.status === "processing" &&
    receipt.verificationPending === true;
  if (!ready && !processing) {
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

  return ready ? "ready" : "processing";
}
