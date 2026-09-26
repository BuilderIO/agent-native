
import {
  defineEventHandler,
  setResponseStatus,
  setResponseHeader,
  getRouterParam,
  getQuery,
} from "h3";
import type { H3Event } from "h3";

import { readBody } from "../server/h3-helpers.js";
import { uint8ArrayToBase64, base64ToUint8Array } from "./storage.js";
import * as manager from "./ydoc-manager.js";
import { searchAndReplace as doSearchAndReplace } from "./ydoc-manager.js";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function getMaxPayloadBytes(event: H3Event): number {
  return (event.context as any)?._collabMaxPayloadBytes ?? DEFAULT_MAX_BYTES;
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
