import { isSameRecord, saveRevisionOf } from "../save-conflict/index.js";
import { saveIfCurrent } from "../save-conflict/server.js";
import type { StoreWriteOptions } from "../settings/store.js";
import { appStateCompareAndSet, appStateGet } from "./store.js";

/**
 * Writes an application state value only if it's still the one the writer read.
 * `expectedRevision` is `saveRevisionOf` that value, or `null` if it read nothing
 * there. Any other writer to the key changes the revision, so it needs no
 * knowledge of this path.
 */
export function appStateSaveIfCurrent(
  sessionId: string,
  key: string,
  expectedRevision: string | null,
  next: Record<string, unknown>,
  options?: StoreWriteOptions,
) {
  return saveIfCurrent({
    record: "draft",
    expectedRevision,
    read: async () => {
      const value = await appStateGet(sessionId, key);
      return { value, revision: value === null ? null : saveRevisionOf(value) };
    },
    write: (current) =>
      appStateCompareAndSet(sessionId, key, current.value, next, options),
    isSameSave: (current) => current !== null && isSameRecord(current, next),
  });
}
