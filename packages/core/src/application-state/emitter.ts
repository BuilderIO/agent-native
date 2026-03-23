import { EventEmitter } from "events";

export interface AppStateEvent {
  source: "app-state";
  type: "change" | "delete";
  key: string;
}

/**
 * Singleton EventEmitter for application-state DB changes.
 * The SSE handler subscribes to this via extraEmitters.
 */
const _emitter = new EventEmitter();

export function getAppStateEmitter(): EventEmitter {
  return _emitter;
}

export function emitAppStateChange(key: string): void {
  const event: AppStateEvent = { source: "app-state", type: "change", key };
  _emitter.emit("app-state", event);
}

export function emitAppStateDelete(key: string): void {
  const event: AppStateEvent = { source: "app-state", type: "delete", key };
  _emitter.emit("app-state", event);
}
