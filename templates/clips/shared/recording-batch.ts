/**
 * Batch calls on recordings (archive, trash, restore, delete, tag, space,
 * visibility) take at most this many ids, so one call stays a bounded amount
 * of work and one approval stays readable.
 */
export const MAX_RECORDING_BATCH = 100;

/** What happened to one recording in a batch call. */
export type RecordingBatchItem =
  | { id: string; status: "changed" | "unchanged" }
  | { id: string; status: "skipped"; reason: string };

/**
 * Sends a selection as few batch calls as the per-call limit allows.
 * Recordings that changed, or were already that way, succeed. Skipped ones
 * fail, and so does every recording in a call the server refused, since a
 * refused call changes none of them.
 */
export async function sendRecordingBatches(
  ids: string[],
  send: (
    ids: string[],
  ) => Promise<{ results: RecordingBatchItem[] } | { id: string }>,
): Promise<{
  succeededIds: string[];
  failedCount: number;
  firstError: string | null;
}> {
  const succeededIds: string[] = [];
  let failedCount = 0;
  let firstError: string | null = null;
  for (let start = 0; start < ids.length; start += MAX_RECORDING_BATCH) {
    const chunk = ids.slice(start, start + MAX_RECORDING_BATCH);
    try {
      const response = await send(chunk);
      if (!("results" in response)) {
        throw new Error("Expected one result per recording.");
      }
      for (const result of response.results) {
        if (result.status === "skipped") {
          failedCount++;
          firstError ??= result.reason;
        } else {
          succeededIds.push(result.id);
        }
      }
    } catch (error) {
      failedCount += chunk.length;
      firstError ??= error instanceof Error ? error.message : String(error);
    }
  }
  return { succeededIds, failedCount, firstError };
}
