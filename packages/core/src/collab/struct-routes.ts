/**
 * HTTP route handlers for structured (JSON) collaborative editing.
 *
 * Mounted under /_agent-native/collab/ by the collab plugin alongside
 * the text-based routes in routes.ts.
 */

import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import type { H3Event } from "h3";
import { getQuery } from "h3";

import { readBody } from "../server/h3-helpers.js";
import type { PatchOp } from "./json-to-yjs.js";
import * as manager from "./ydoc-manager.js";

/** Default maximum payload size (2 MB). Overridden by plugin via event.context. */
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

/**
 * POST /_agent-native/collab/:docId/json
 *
 * Apply full JSON content to a collaborative document. The server diffs
 * against the current Yjs state and applies minimal operations.
 *
 * Body: { json: any, fieldName?: string, type?: "map"|"array", requestSource?: string }
 */
export const postCollabJson = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const rawBody = await readBody(event);
  if (!enforcePayloadLimit(event, rawBody)) {
    return { error: "Payload too large" };
  }
  const { json, fieldName, type, requestSource } = rawBody as {
    json?: any;
    fieldName?: string;
    type?: "map" | "array";
    requestSource?: string;
  };

  if (json === undefined) {
    setResponseStatus(event, 400);
    return { error: "json required" };
  }

  await manager.applyJson(
    docId,
    json,
    fieldName ?? "data",
    type ?? (Array.isArray(json) ? "array" : "map"),
    requestSource ?? "agent",
  );

  return { ok: true };
});

/**
 * POST /_agent-native/collab/:docId/patch
 *
 * Apply surgical JSON patch operations to a collaborative document.
 *
 * Body: { ops: PatchOp[], fieldName?: string, requestSource?: string }
 */
export const postCollabPatch = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const rawBody = await readBody(event);
  if (!enforcePayloadLimit(event, rawBody)) {
    return { error: "Payload too large" };
  }
  const { ops, fieldName, requestSource } = rawBody as {
    ops?: PatchOp[];
    fieldName?: string;
    requestSource?: string;
  };

  if (!ops || !Array.isArray(ops)) {
    setResponseStatus(event, 400);
    return { error: "ops (array) required" };
  }

  await manager.applyPatchOps(
    docId,
    ops,
    fieldName ?? "data",
    requestSource ?? "agent",
  );

  return { ok: true };
});

/**
 * GET /_agent-native/collab/:docId/json
 *
 * Returns the current JSON state of a collaborative document.
 *
 * Query param: fieldName (default: "data")
 */
export const getCollabJson = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const query = getQuery(event);
  const fieldName = (query.fieldName as string) ?? "data";

  const data = await manager.getJson(docId, fieldName);
  return { docId, data };
});
