/**
 * HTTP route handlers for collaborative editing.
 *
 * Mounted under /_agent-native/collab/ by the collab plugin.
 */

import {
  defineEventHandler,
  setResponseStatus,
  getRouterParam,
  getQuery,
} from "h3";
import type { H3Event } from "h3";

import { readBody } from "../server/h3-helpers.js";
import { uint8ArrayToBase64, base64ToUint8Array } from "./storage.js";
import * as manager from "./ydoc-manager.js";
import { searchAndReplace as doSearchAndReplace } from "./ydoc-manager.js";

/** Default maximum payload size (2 MB). Overridden by plugin via event.context. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function getMaxPayloadBytes(event: H3Event): number {
  return (event.context as any)?._collabMaxPayloadBytes ?? DEFAULT_MAX_BYTES;
}

/**
 * Check the serialized body length against the configured limit.
 * Returns true if within limits; sets 413 status and returns false otherwise.
 */
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
 * GET /_agent-native/collab/:docId/state
 *
 * Returns full Yjs document state as base64 for initial client load.
 */
export const getCollabState = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const query = getQuery(event);
  const encodedStateVector =
    typeof query.stateVector === "string" ? query.stateVector : null;
  let state: Uint8Array;
  if (encodedStateVector) {
    try {
      state = await manager.getIncUpdate(
        docId,
        base64ToUint8Array(encodedStateVector),
      );
    } catch {
      setResponseStatus(event, 400);
      return { error: "stateVector must be base64-encoded" };
    }
  } else {
    state = await manager.getState(docId);
  }
  return {
    docId,
    state: uint8ArrayToBase64(state),
  };
});

/**
 * POST /_agent-native/collab/:docId/update
 *
 * Client sends a Yjs update (base64). Server applies it, persists, and
 * emits a change event so other clients pick it up via polling.
 *
 * Body: { update: string (base64), requestSource?: string }
 */
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
  await manager.applyUpdate(docId, binary, requestSource);

  return { ok: true };
});

/**
 * POST /_agent-native/collab/:docId/text
 *
 * Agent sends full text content. Server computes diff against current
 * Yjs state and applies minimal operations.
 *
 * Body: { text: string, fieldName?: string, requestSource?: string }
 */
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

/**
 * POST /_agent-native/collab/:docId/search-replace
 *
 * Search-and-replace text in the Y.XmlFragment (ProseMirror tree).
 * Produces minimal Yjs operations for cursor-preserving updates.
 *
 * Body: { find: string, replace: string, requestSource?: string }
 */
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
