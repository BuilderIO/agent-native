import { fail } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { MAX_RECORDING_BATCH } from "@shared/recording-batch";
import { z } from "zod";

import { assertRecordingNotExpired } from "./recording-read-access.js";

export { MAX_RECORDING_BATCH };

export function recordingIdsField(verb: string) {
  return z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_RECORDING_BATCH)
    .describe(
      `Up to ${MAX_RECORDING_BATCH} recording ids to ${verb} in one call, instead of one call per recording. Every one is checked before any changes, and the result lists each recording's outcome.`,
    );
}

/** The single id and the batch list together, without repeats. */
export function requestedRecordingIds(
  id: string | undefined,
  ids: string[] | undefined,
): string[] {
  const unique = [...new Set([...(id ? [id] : []), ...(ids ?? [])])];
  if (!unique.length) {
    fail("Provide id or ids.", {
      errorCode: "recording_ids_required",
      statusCode: 400,
    });
  }
  if (unique.length > MAX_RECORDING_BATCH) {
    fail(
      `Change at most ${MAX_RECORDING_BATCH} recordings per call; this one named ${unique.length}.`,
      { errorCode: "too_many_recordings", statusCode: 400 },
    );
  }
  return unique;
}

/**
 * An action's outputSchema for one call on several recordings: each
 * recording's outcome with `fields`, then the counts.
 */
export function recordingBatchSchema<T extends z.ZodRawShape>(fields: T) {
  return z.object({
    results: z.array(
      z.union([
        z.object({
          id: z.string(),
          status: z.enum(["changed", "unchanged"]),
          ...fields,
        }),
        z.object({
          id: z.string(),
          status: z.literal("skipped"),
          reason: z.string(),
        }),
      ]),
    ),
    changed: z.number(),
    unchanged: z.number(),
    skipped: z.number(),
  });
}

export type RecordingBatchStatus = "changed" | "unchanged";

export type RecordingBatchResult<T extends object> =
  | ({ id: string; status: RecordingBatchStatus } & T)
  | { id: string; status: "skipped"; reason: string };

export interface RecordingBatch<T extends object> {
  results: RecordingBatchResult<T>[];
  changed: number;
  unchanged: number;
  skipped: number;
}

/**
 * Throws, naming each recording, unless the caller can edit every one, so a
 * batch never changes some recordings and then stops on one it can't.
 */
export async function assertRecordingsEditable(ids: string[]): Promise<void> {
  const failures: string[] = [];
  for (const id of ids) {
    try {
      assertRecordingNotExpired(await assertAccess("recording", id, "editor"));
    } catch (error) {
      failures.push(
        `${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length) {
    throw new ForbiddenError(
      `Nothing was changed: ${failures.length} of ${ids.length} recordings can't be edited. ${failures.join("; ")}`,
    );
  }
}

/**
 * Applies one change to each recording after checking them all. A recording
 * that changes underneath the call (deleted, or claimed by another write) is
 * reported as skipped with the reason, and the rest still apply.
 */
export async function applyToRecordings<T extends object>(
  ids: string[],
  apply: (id: string) => Promise<{ status: RecordingBatchStatus } & T>,
): Promise<RecordingBatch<T>> {
  await assertRecordingsEditable(ids);
  const results: RecordingBatchResult<T>[] = [];
  for (const id of ids) {
    try {
      results.push({ id, ...(await apply(id)) });
    } catch (error) {
      results.push({
        id,
        status: "skipped",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    results,
    changed: results.filter((result) => result.status === "changed").length,
    unchanged: results.filter((result) => result.status === "unchanged").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
}
