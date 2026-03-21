import { defineEventHandler } from "h3";
import { syncResult } from "../../../lib/watcher";

export default defineEventHandler(() => {
  if (syncResult.status !== "ready") return { enabled: false, conflicts: 0 };
  return { enabled: true, connected: true, conflicts: syncResult.fileSync.conflictCount };
});
