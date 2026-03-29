import { EventEmitter } from "events";

export interface AppStateEvent {
  source: "app-state";
  type: "change" | "delete";
  key: string;
  requestSource?: string;
}

/**
 * Singleton EventEmitter for application-state DB changes.
 * The SSE handler subscribes to this via extraEmitters.
 */
const _emitter = new EventEmitter();

export function getAppStateEmitter(): EventEmitter {
  return _emitter;
}

export function emitAppStateChange(key: string, requestSource?: string): void {
  const event: AppStateEvent = {
    source: "app-state",
    type: "change",
    key,
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("app-state", event);
}

export function emitAppStateDelete(key: string, requestSource?: string): void {
  const event: AppStateEvent = {
    source: "app-state",
    type: "delete",
    key,
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("app-state", event);
}
