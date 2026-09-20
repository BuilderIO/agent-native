import { EventEmitter } from "events";

export interface CollabEvent {
  source: "collab";
  type: "yjs-update";
  docId: string;
  /** Base64-encoded Yjs update */
  update: string;
  requestSource?: string;
}

const _emitter = new EventEmitter();

export function getCollabEmitter(): EventEmitter {
  return _emitter;
}

export function emitCollabUpdate(
  docId: string,
  update: string,
  requestSource?: string,
): void {
  const event: CollabEvent = {
    source: "collab",
    type: "yjs-update",
    docId,
    update,
    ...(requestSource && { requestSource }),
  };
  _emitter.emit("collab", event);
}
