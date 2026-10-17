import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getRouterParam,
  getQuery,
  getRequestHeader,
} from "h3";
import type { H3Event } from "h3";
import * as Y from "yjs";

import { readBody } from "../server/h3-helpers.js";
import { COLLAB_MAX_PAYLOAD_BYTES } from "./limits.js";
import { uint8ArrayToBase64, base64ToUint8Array } from "./storage.js";
import * as manager from "./ydoc-manager.js";
import { searchAndReplace as doSearchAndReplace } from "./ydoc-manager.js";

function getMaxPayloadBytes(event: H3Event): number {
  return (
    (event.context as any)?._collabMaxPayloadBytes ?? COLLAB_MAX_PAYLOAD_BYTES
  );
}

function enforcePayloadLimit(event: H3Event, body: unknown): boolean {
  const maxBytes = getMaxPayloadBytes(event);
  const encoded = typeof body === "string" ? body : JSON.stringify(body ?? "");
  if (encoded.length > maxBytes) {
    setResponseStatus(event, 413);
    return false;
  }
  return true;
}

/**
 * The client's state vector, or null when it is not one. A vector is a flat
 * list of clocks, read in one pass and bounded by the URL, so reading it
 * here is not the document decode live copies keep off this thread.
 */
function readStateVector(encoded: string): Uint8Array | null {
  try {
    const stateVector = base64ToUint8Array(encoded);
    Y.decodeStateVector(stateVector);
    return stateVector;
    // coercion-ok: null is this reader's typed "not a state vector"; the route answers 400
  } catch {
    return null;
  }
}

export const getCollabState = defineEventHandler(async (event: H3Event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const query = getQuery(event);
  const encodedStateVector =
    typeof query.stateVector === "string" ? query.stateVector : null;
  let activityBaseline:
    | { status: "ready"; version: number; cursor: string }
    | { status: "unavailable" }
    | undefined;
  if (getRequestHeader(event, "x-agent-native-poll-baseline") === "1") {
    try {
      const { getCurrentPollBaseline } = await import("../server/poll.js");
      activityBaseline = {
        status: "ready",
        ...(await getCurrentPollBaseline()),
      };
    } catch {
      activityBaseline = { status: "unavailable" };
    }
  }
  let state: Uint8Array;
  if (encodedStateVector !== null) {
    const stateVector = readStateVector(encodedStateVector);
    if (!stateVector) {
      setResponseStatus(event, 400);
      return { error: "stateVector must be a base64-encoded Yjs state vector" };
    }
    state = await manager.getIncUpdate(docId, stateVector);
  } else {
    state = await manager.getState(docId);
  }
  return {
    docId,
    state: uint8ArrayToBase64(state),
    ...(activityBaseline ? { activityBaseline } : {}),
  };
});

export const postCollabUpdate = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const rawBody = await readBody(event);
  if (!enforcePayloadLimit(event, rawBody)) {
    return { error: "Payload too large" };
  }
  const { update, requestSource } = rawBody as {
    update?: string;
    requestSource?: string;
  };

  if (!update) {
    setResponseStatus(event, 400);
    return { error: "update (base64) required" };
  }

  const binary = base64ToUint8Array(update);
  const outcome = await manager.applyUpdate(docId, binary, requestSource);

  return outcome ? { ok: true, ...outcome } : { ok: true };
});

export const postCollabText = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const rawBody = await readBody(event);
  if (!enforcePayloadLimit(event, rawBody)) {
    return { error: "Payload too large" };
  }
  const { text, fieldName, requestSource } = rawBody as {
    text?: string;
    fieldName?: string;
    requestSource?: string;
  };

  if (text === undefined) {
    setResponseStatus(event, 400);
    return { error: "text required" };
  }

  const result = await manager.applyText(
    docId,
    text,
    fieldName ?? "content",
    requestSource ?? "agent",
  );

  return { ok: true, text: result };
});

export const postCollabSearchReplace = defineEventHandler(
  async (event: H3Event) => {
    const docId = getRouterParam(event, "docId");
    if (!docId) {
      setResponseStatus(event, 400);
      return { error: "docId required" };
    }

    const rawBody = await readBody(event);
    if (!enforcePayloadLimit(event, rawBody)) {
      return { error: "Payload too large" };
    }
    const { find, replace, requestSource } = rawBody as {
      find?: string;
      replace?: string;
      requestSource?: string;
    };

    if (!find) {
      setResponseStatus(event, 400);
      return { error: "find required" };
    }

    const result = await doSearchAndReplace(
      docId,
      find,
      replace ?? "",
      requestSource ?? "agent",
    );

    return { ok: true, found: result.found };
  },
);
