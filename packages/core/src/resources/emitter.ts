import { EventEmitter } from "events";

export interface ResourceEvent {
  source: "resources";
  type: "change" | "delete";
  id: string;
  path: string;
  owner: string;
  requestSource?: string;
}

const _emitter = new EventEmitter();

export function getResourcesEmitter(): EventEmitter {
  return _emitter;
}

export function emitResourceChange(
  id: string,
  path: string,
  owner: string,
  requestSource?: string,
): void {
  const event: ResourceEvent = {
    source: "resources",
    type: "change",
    id,
    path,
    owner,
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("resources", event);
}

export function emitResourceDelete(
  id: string,
  path: string,
  owner: string,
  requestSource?: string,
): void {
  const event: ResourceEvent = {
    source: "resources",
    type: "delete",
    id,
    path,
    owner,
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("resources", event);
}
