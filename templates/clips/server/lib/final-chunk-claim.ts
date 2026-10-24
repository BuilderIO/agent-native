/**
 * Who decides an upload's ending when its final chunk and a cancel meet. The
 * final chunk claims the upload here before Clips takes its bytes, and the
 * cancel claims it by failing the upload state; both write the upload state
 * with a compare-and-swap, so only one wins. A cancel that finds the claim
 * leaves the upload to finish and notes itself on the claim, and a final
 * chunk that then fails carries that cancel out.
 */
import crypto from "node:crypto";

import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { createError } from "h3";

const MAX_CAS_ATTEMPTS = 8;

const uploadStateKey = (recordingId: string) =>
  `recording-upload-${recordingId}`;
const claimKey = (recordingId: string) =>
  `recording-upload-final-chunk-${recordingId}`;

export interface FinalChunkClaim extends Record<string, unknown> {
  claimId: string;
  claimedAt: string;
  /** A cancel came while the final chunk held the upload. */
  cancelRequested?: true;
}

export function readFinalChunkClaim(
  recordingId: string,
): Promise<Record<string, unknown> | null> {
  return readAppState(claimKey(recordingId));
}

/**
 * Whether Clips has an upload's final chunk: finalization moved the
 * recording on, or a final chunk holds its claim. A cancel or a repeated
 * start leaves such an upload to finish.
 */
export function hasFinalChunk(
  status: string | null | undefined,
  claim: Record<string, unknown> | null,
): boolean {
  return (
    status === "processing" ||
    status === "ready" ||
    (status === "uploading" && claim !== null)
  );
}

function contention(): never {
  throw createError({
    statusCode: 503,
    message: "This upload is changing. Try again.",
  });
}

/**
 * Claims the upload for its final chunk, before Clips takes the bytes. Null
 * when a cancel claimed it first, and the chunk must be refused. A repeat of
 * the final chunk takes over a claim no cancel has reached.
 */
export async function claimFinalChunk(
  recordingId: string,
): Promise<FinalChunkClaim | null> {
  const claim: FinalChunkClaim = {
    claimId: crypto.randomUUID(),
    claimedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const [uploadState, current] = await Promise.all([
      readAppState(uploadStateKey(recordingId)),
      readFinalChunkClaim(recordingId),
    ]);
    if (
      uploadState?.aborted === true ||
      uploadState?.status === "failed" ||
      current?.cancelRequested === true
    ) {
      return null;
    }
    // The upload state changes too, so a cancel that read it before this
    // claim fails its own compare-and-swap and reads the claim.
    const claimed = await compareAndSetManyAppState([
      {
        key: uploadStateKey(recordingId),
        expectedValue: uploadState,
        nextValue: {
          ...(uploadState ?? { recordingId }),
          finalChunkClaimedAt: claim.claimedAt,
        },
      },
      { key: claimKey(recordingId), expectedValue: current, nextValue: claim },
    ]);
    if (claimed) return claim;
  }
  return contention();
}

/**
 * Gives the claim up once its final chunk is done with, so the upload counts
 * as uploading again if the chunk failed. True when a cancel came meanwhile:
 * a caller whose chunk failed then cancels the upload.
 */
export async function releaseFinalChunk(
  recordingId: string,
  claim: FinalChunkClaim,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readFinalChunkClaim(recordingId);
    // A repeat of the final chunk took it over, and ends it.
    if (current?.claimId !== claim.claimId) return false;
    if (await compareAndSetAppState(claimKey(recordingId), current, null)) {
      return current.cancelRequested === true;
    }
  }
  return contention();
}

/**
 * For a cancel that found the upload claimed by its final chunk: notes the
 * cancel on the claim. False once the claim is gone, and the cancel can go
 * ahead.
 */
export async function requestCancelOfClaimedUpload(
  recordingId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readFinalChunkClaim(recordingId);
    if (current === null) return false;
    if (current.cancelRequested === true) return true;
    if (
      await compareAndSetAppState(claimKey(recordingId), current, {
        ...current,
        cancelRequested: true,
      })
    ) {
      return true;
    }
  }
  return contention();
}
