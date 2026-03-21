import { createFileWatcher } from "@agent-native/core";
import type { SSEHandlerOptions } from "@agent-native/core";

/** Shared chokidar watcher — used by SSE route and plugins */
export const watcher = createFileWatcher("./data");

/** Extra SSE emitters (populated by file-sync plugin at startup) */
export const sseExtraEmitters: NonNullable<SSEHandlerOptions["extraEmitters"]> =
  [];

/** Sync result — set by file-sync plugin */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let syncResult: any = { status: "disabled" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setSyncResult(result: any) {
  syncResult = result;
  if (result.status === "ready" && result.sseEmitter) {
    sseExtraEmitters.push(result.sseEmitter);
  }
}
