import {
  defineEventHandler,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateList,
  appStateDeleteByPrefix,
} from "./store.js";

const SESSION_ID = "local";

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "");
}

// --- Generic state handlers ---

export const getState = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const value = await appStateGet(SESSION_ID, key);
  if (!value) {
    setResponseStatus(event, 404);
    return { error: `No state for ${key}` };
  }
  return value;
});

export const putState = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  const body = await readBody(event);
  await appStatePut(SESSION_ID, key, body);
  return body;
});

export const deleteState = defineEventHandler(async (event: H3Event) => {
  const key = safeKey(String(getRouterParam(event, "key")));
  await appStateDelete(SESSION_ID, key);
  return { ok: true };
});

// --- Multi-draft compose handlers ---

function composeDraftKey(id: string): string {
  return `compose-${safeKey(id)}`;
}

/** List all compose drafts */
export const listComposeDrafts = defineEventHandler(async () => {
  const items = await appStateList(SESSION_ID, "compose-");
  return items.map((item) => item.value);
});

/** Get a single compose draft */
export const getComposeDraft = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const value = await appStateGet(SESSION_ID, composeDraftKey(id));
  if (!value) {
    setResponseStatus(event, 404);
    return { error: "Draft not found" };
  }
  return value;
});

/** Create or update a compose draft */
export const putComposeDraft = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  const body = await readBody(event);
  const { subject, body: bodyText } = body;

  if (typeof subject !== "string" || typeof bodyText !== "string") {
    setResponseStatus(event, 400);
    return { error: "subject and body are required strings" };
  }

  const state = { ...body, id };
  await appStatePut(SESSION_ID, composeDraftKey(id), state);
  return state;
});

/** Delete a single compose draft */
export const deleteComposeDraft = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  await appStateDelete(SESSION_ID, composeDraftKey(id));
  return { ok: true };
});

/** Delete all compose drafts */
export const deleteAllComposeDrafts = defineEventHandler(async () => {
  await appStateDeleteByPrefix(SESSION_ID, "compose-");
  return { ok: true };
});
