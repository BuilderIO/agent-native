import type { H3Event } from "h3";

import { readBodyWithSizeLimit } from "../server/h3-helpers.js";

export const DEFAULT_COLLAB_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const collabBodyPromises = new WeakMap<H3Event, Promise<unknown>>();

export function getCollabMaxPayloadBytes(event: H3Event): number {
  return (
    (event.context as { _collabMaxPayloadBytes?: number } | undefined)
      ?._collabMaxPayloadBytes ?? DEFAULT_COLLAB_MAX_PAYLOAD_BYTES
  );
}

export function readCollabBody<T = any>(event: H3Event): Promise<T> {
  let body = collabBodyPromises.get(event);
  if (!body) {
    body = readBodyWithSizeLimit<T>(event, getCollabMaxPayloadBytes(event));
    collabBodyPromises.set(event, body);
  }
  return body as Promise<T>;
}
