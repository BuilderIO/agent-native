import { createSSEHandler } from "./sse.js";
import type { SSEHandlerOptions } from "./sse.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import { getSettingsEmitter } from "../settings/store.js";
import { getResourcesEmitter } from "../resources/emitter.js";

const _emitters: NonNullable<SSEHandlerOptions["extraEmitters"]> = [];
let _emittersRegistered = false;

/** Ensure the DB change emitters are wired into SSE. */
function ensureEmitters() {
  if (_emittersRegistered) return;
  _emittersRegistered = true;
  _emitters.push({ emitter: getAppStateEmitter(), event: "app-state" });
  _emitters.push({ emitter: getSettingsEmitter(), event: "settings" });
  _emitters.push({ emitter: getResourcesEmitter(), event: "resources" });
}

export function getDefaultSSEEmitters(): NonNullable<
  SSEHandlerOptions["extraEmitters"]
> {
  ensureEmitters();
  return _emitters;
}

// --- Legacy file sync compat (deprecated — data is SQL-backed now) ---

/** @deprecated File sync is no longer used. Returns no-op status. */
export function defaultSyncStatusHandler() {
  return { enabled: false, conflicts: 0 };
}

/** @deprecated File sync is no longer used. No-op. */
export function setDefaultSyncResult(_result: any) {}

/**
 * Create the default SSE handler for all templates.
 *
 * Streams DB change events (application state, settings) to connected clients.
 * No file watcher — all data lives in SQL.
 */
export function createDefaultSSEHandler() {
  ensureEmitters();
  return createSSEHandler({
    extraEmitters: _emitters,
  });
}
