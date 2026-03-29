import { createSSEHandler } from "./sse.js";
import type { SSEHandlerOptions } from "./sse.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import { getSettingsEmitter } from "../settings/store.js";
import { getResourcesEmitter } from "../resources/emitter.js";
import { getChatThreadsEmitter } from "../chat-threads/emitter.js";
import { recordChange, createPollHandler } from "./poll.js";

const _emitters: NonNullable<SSEHandlerOptions["extraEmitters"]> = [];
let _emittersRegistered = false;

/** Wire DB change emitters into both SSE and the polling version counter. */
function ensureEmitters() {
  if (_emittersRegistered) return;
  _emittersRegistered = true;

  const appState = getAppStateEmitter();
  const settings = getSettingsEmitter();
  const resources = getResourcesEmitter();
  const chatThreads = getChatThreadsEmitter();

  _emitters.push({ emitter: appState, event: "app-state" });
  _emitters.push({ emitter: settings, event: "settings" });
  _emitters.push({ emitter: resources, event: "resources" });
  _emitters.push({ emitter: chatThreads, event: "chat-threads" });

  // Also record changes for the polling endpoint
  appState.on("app-state", (data: any) =>
    recordChange({ source: "app-state", ...data }),
  );
  settings.on("settings", (data: any) =>
    recordChange({ source: "settings", ...data }),
  );
  resources.on("resources", (data: any) =>
    recordChange({ source: "resources", ...data }),
  );
  chatThreads.on("chat-threads", (data: any) =>
    recordChange({ source: "chat-threads", ...data }),
  );
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
 * @deprecated Use createDefaultPollHandler() for serverless-compatible polling.
 */
export function createDefaultSSEHandler() {
  ensureEmitters();
  return createSSEHandler({
    extraEmitters: _emitters,
  });
}

/**
 * Create the default polling handler for all templates.
 * Works in all deployment environments (serverless, edge, long-lived).
 */
export function createDefaultPollHandler() {
  ensureEmitters();
  return createPollHandler();
}
