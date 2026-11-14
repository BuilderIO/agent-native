import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import type { H3Event } from "h3";
import { getQuery } from "h3";

import type { PatchOp } from "./json-to-yjs.js";
import { readCollabBody } from "./payload.js";
import * as manager from "./ydoc-manager.js";

export const postCollabJson = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const rawBody = await readCollabBody(event);
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

export const postCollabPatch = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const rawBody = await readCollabBody(event);
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
