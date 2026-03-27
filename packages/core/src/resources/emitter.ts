import { EventEmitter } from "events";

export interface ResourceEvent {
  source: "resources";
  type: "change" | "delete";
  id: string;
  path: string;
  owner: string;
}

/**
 * Singleton EventEmitter for resources DB changes.
 * The SSE handler subscribes to this via extraEmitters.
 */
const _emitter = new EventEmitter();

export function getResourcesEmitter(): EventEmitter {
  return _emitter;
}

export function emitResourceChange(
  id: string,
  path: string,
  owner: string,
): void {
  const event: ResourceEvent = {
    source: "resources",
    type: "change",
    id,
    path,
    owner,
  };
  _emitter.emit("resources", event);
}

export function emitResourceDelete(
  id: string,
  path: string,
  owner: string,
): void {
  const event: ResourceEvent = {
    source: "resources",
    type: "delete",
    id,
    path,
    owner,
  };
  _emitter.emit("resources", event);
}
