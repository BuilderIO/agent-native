import { createFileWatcher } from "@agent-native/core/server";
import type { SSEHandlerOptions } from "@agent-native/core/server";

export const watcher = createFileWatcher("./data");
export const sseExtraEmitters: NonNullable<SSEHandlerOptions["extraEmitters"]> =
  [];
export let syncResult: any = { status: "disabled" };
export function setSyncResult(result: any) {
  syncResult = result;
  if (result.status === "ready" && result.sseEmitter) {
    sseExtraEmitters.push(result.sseEmitter);
  }
}
