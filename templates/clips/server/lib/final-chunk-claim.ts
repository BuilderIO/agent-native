/**
 * Where a Content page's upload stands, for every path that has to know: a
 * repeated start, a cancel and the Content chunk route. It is kept in three
 * places, the final chunk's claim, the upload state and the recording row,
 * and only `phaseOf` reads them together.
 *
 * The final chunk claims the upload before Clips takes its bytes, and writes
 * where the upload went into the upload state before it gives the claim up.
 * A cancel, or another send of the final chunk, changes nothing while the
 * claim is live. The claim and the cancel write the upload state with a
 * compare-and-swap, so a cancel that read it before a claim fails its own
 * and reads again.
 *
 * The lease reaper reads none of this: the row's lease decides between it
 * and a final chunk. Before it claims, the final chunk renews the lease of a
 * row still uploading to outlast the claim, and the reaper fails only a row
 * whose lease ran out, each in one conditional update. So either the reaper
 * failed the row first and the final chunk finds it ended, or the reaper
 * leaves it.
 */
import crypto from "node:crypto";

import {
  compareAndSetAppState,
  compareAndSetManyAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { and, eq, sql } from "drizzle-orm";
import { createError } from "h3";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

const MAX_CAS_ATTEMPTS = 8;

/**
 * How long a claim holds the upload: a little longer than the final chunk's
 * request can run, which is Clips' function timeout (75 s in
 * `netlify.toml`). A claim older than this was left by a request that was
 * cut off, so the upload counts as uploading again, and the next final
 * chunk or cancel takes it over. Content's `CLIP_FINISHING_WAIT_MS`, how
 * long it keeps sending a final chunk Clips is still taking, follows it.
 */
export const FINAL_CHUNK_CLAIM_TTL_MS = 2 * 60 * 1000;

/**
 * - `uploading`: Clips is still taking chunks.
 * - `finishing`: a final chunk holds the upload.
 * - `parked`: Clips has the whole file and waits for storage to be connected.
 * - `finished`: Clips is making the Clip, or made it.
 * - `ended`: cancelled or failed.
 */
export type UploadPhase =
  | "uploading"
  | "finishing"
  | "parked"
  | "finished"
  | "ended";

export interface UploadStanding {
  phase: UploadPhase;
  /** The recording's own status. */
  status: string;
}

const uploadStateKey = (recordingId: string) =>
  `recording-upload-${recordingId}`;
const claimKey = (recordingId: string) =>
  `recording-upload-final-chunk-${recordingId}`;

/** Where the final chunk left the upload, in the upload state. */
const OUTCOME = "finalChunkOutcome";

export interface FinalChunkClaim extends Record<string, unknown> {
  claimId: string;
  claimedAt: string;
}

function liveClaim(
  claim: Record<string, unknown> | null,
  now: number,
): boolean {
  if (!claim) return false;
  const claimedAt =
    typeof claim.claimedAt === "string" ? Date.parse(claim.claimedAt) : NaN;
  // A claim with no readable time can't be told from an abandoned one.
  return (
    Number.isFinite(claimedAt) && now - claimedAt < FINAL_CHUNK_CLAIM_TTL_MS
  );
}

function phaseOf(
  claim: Record<string, unknown> | null,
  uploadState: Record<string, unknown> | null,
  row: { status: string },
  now: number,
): UploadPhase {
  if (liveClaim(claim, now)) return "finishing";
  if (
    row.status === "failed" ||
    uploadState?.aborted === true ||
    uploadState?.status === "failed"
  ) {
    return "ended";
  }
  if (
    row.status === "processing" ||
    row.status === "ready" ||
    uploadState?.[OUTCOME] === "finished"
  ) {
    return "finished";
  }
  return uploadState?.[OUTCOME] === "parked" ? "parked" : "uploading";
}

async function readRow(recordingId: string, ownerEmail: string) {
  const [row = null] = await getDb()
    .select({ status: schema.recordings.status })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  return row;
}

/**
 * Where the upload stands, read in its owner's request. Null when the
 * recording is gone. The claim is read first, the upload state next and the
 * row last: the final chunk writes the row and its outcome before it gives
 * the claim up, so one that finishes between two reads shows in the later.
 */
export async function readUploadPhase(
  recordingId: string,
  ownerEmail: string,
  options: { now?: number } = {},
): Promise<UploadStanding | null> {
  const claim = await readAppState(claimKey(recordingId));
  const uploadState = await readAppState(uploadStateKey(recordingId));
  const row = await readRow(recordingId, ownerEmail);
  if (!row) return null;
  return {
    phase: phaseOf(claim, uploadState, row, options.now ?? Date.now()),
    status: row.status,
  };
}

/**
 * Keeps the row's lease for at least a claim's life, while it is uploading.
 * False once something else ended or finished it.
 */
async function holdLease(
  recordingId: string,
  ownerEmail: string,
): Promise<boolean> {
  const lease = schema.recordings.uploadLeaseExpiresAt;
  const until = new Date(Date.now() + FINAL_CHUNK_CLAIM_TTL_MS).toISOString();
  const held = await getDb()
    .update(schema.recordings)
    .set({
      uploadLeaseExpiresAt: sql`CASE WHEN ${lease} > ${until} THEN ${lease} ELSE ${until} END`,
    })
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        eq(schema.recordings.status, "uploading"),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    )
    .returning({ id: schema.recordings.id });
  return held.length > 0;
}

function contention(): never {
  throw createError({
    statusCode: 503,
    message: "This upload is changing. Try again.",
  });
}

/**
 * Claims the upload for its final chunk, before Clips takes the bytes, while
 * it is `uploading`; an expired claim counts as none. The row's lease is
 * renewed first, so the reaper can't fail it under the claim. Otherwise the
 * phase it is in, which the chunk is answered with, and null once it is gone.
 */
export async function claimFinalChunk(
  recordingId: string,
  ownerEmail: string,
): Promise<{ claim: FinalChunkClaim } | UploadStanding | null> {
  const claim: FinalChunkClaim = {
    claimId: crypto.randomUUID(),
    claimedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readAppState(claimKey(recordingId));
    const uploadState = await readAppState(uploadStateKey(recordingId));
    const row = await readRow(recordingId, ownerEmail);
    if (!row) return null;
    const phase = phaseOf(current, uploadState, row, Date.now());
    if (phase !== "uploading") return { phase, status: row.status };
    // A lease renewed for a claim that then loses its compare-and-swap only
    // runs two minutes longer, which nothing needs undone. One that finds no
    // row uploading reads again, to answer how it ended.
    if (!(await holdLease(recordingId, ownerEmail))) continue;
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
    if (claimed) return { claim };
  }
  return contention();
}

/**
 * Writes where an accepted final chunk left the upload, before its claim
 * comes off: `parked` while Clips waits for storage, `finished` once it is
 * making the Clip or verifying the file.
 */
export async function recordFinalChunkOutcome(
  recordingId: string,
  outcome: "parked" | "finished",
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const uploadState = await readAppState(uploadStateKey(recordingId));
    if (
      await compareAndSetAppState(uploadStateKey(recordingId), uploadState, {
        ...(uploadState ?? { recordingId }),
        [OUTCOME]: outcome,
      })
    ) {
      return;
    }
  }
  return contention();
}

/**
 * An upload state taking chunks again, as a resumed upload's does, without
 * the outcome an earlier final chunk left: that upload isn't finished or
 * parked any more, and its phase would otherwise still say so.
 */
export function withoutFinalChunkOutcome(
  uploadState: Record<string, unknown>,
): Record<string, unknown> {
  const { [OUTCOME]: _outcome, ...reopened } = uploadState;
  return reopened;
}

/** Gives the claim up once its final chunk is done with. */
export async function releaseFinalChunk(
  recordingId: string,
  claim: FinalChunkClaim,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readAppState(claimKey(recordingId));
    // This claim expired and a later final chunk or cancel took it over;
    // that one gives it up.
    if (current?.claimId !== claim.claimId) return;
    if (await compareAndSetAppState(claimKey(recordingId), current, null)) {
      return;
    }
  }
  return contention();
}
