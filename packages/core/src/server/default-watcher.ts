import { createFileWatcher, createSSEHandler } from "./sse.js";
import type { SSEHandlerOptions } from "./sse.js";

const _emitters: NonNullable<SSEHandlerOptions["extraEmitters"]> = [];
let _syncResult: any = { status: "disabled" };
let _watcher: ReturnType<typeof createFileWatcher> | undefined;

export function getDefaultWatcher() {
  if (!_watcher) {
    _watcher = createFileWatcher(["./data", "./application-state"]);
  }
  return _watcher;
}

export function getDefaultSSEEmitters(): NonNullable<
  SSEHandlerOptions["extraEmitters"]
> {
  return _emitters;
}

export function getDefaultSyncResult(): any {
  return _syncResult;
}

export function setDefaultSyncResult(result: any) {
  _syncResult = result;
  if (result.status === "ready" && result.sseEmitter) {
    _emitters.length = 0;
    _emitters.push(result.sseEmitter);
  }
}

export function defaultSyncStatusHandler() {
  const result = _syncResult;
  if (result.status !== "ready") {
    return { enabled: false, conflicts: 0 };
  }
  return {
    enabled: true,
    connected: true,
    conflicts: result.fileSync.conflictCount,
  };
}

export function createDefaultSSEHandler() {
  return createSSEHandler(getDefaultWatcher(), {
    extraEmitters: _emitters,
    contentRoot: "./data",
  });
}
