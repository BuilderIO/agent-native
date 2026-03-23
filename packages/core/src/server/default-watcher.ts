import { createFileWatcher, createSSEHandler } from "./sse.js";
import type { SSEHandlerOptions } from "./sse.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import { getSettingsEmitter } from "../settings/store.js";

const _emitters: NonNullable<SSEHandlerOptions["extraEmitters"]> = [];
let _syncResult: any = { status: "disabled" };
let _watcher: ReturnType<typeof createFileWatcher> | undefined;
let _appStateEmitterRegistered = false;

export function getDefaultWatcher() {
  if (!_watcher) {
    _watcher = createFileWatcher("./data");
  }
  return _watcher;
}

/** Ensure the application-state DB emitter is wired into SSE. */
function ensureAppStateEmitter() {
  if (_appStateEmitterRegistered) return;
  _appStateEmitterRegistered = true;
  _emitters.push({ emitter: getAppStateEmitter(), event: "app-state" });
  _emitters.push({ emitter: getSettingsEmitter(), event: "settings" });
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
  ensureAppStateEmitter();
  return createSSEHandler(getDefaultWatcher(), {
    extraEmitters: _emitters,
    contentRoot: "./data",
  });
}
