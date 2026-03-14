export { FileSync, type FileSyncOptions, type SyncEvent } from "./file-sync.js";
export { threeWayMerge, type MergeResult } from "./merge.js";
export { loadSyncConfig, shouldSyncFile, getDocId, type SyncConfig } from "./config.js";
export type { FileSyncAdapter, FileRecord, FileChange, Unsubscribe } from "./types.js";
