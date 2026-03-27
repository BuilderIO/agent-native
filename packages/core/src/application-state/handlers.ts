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
import { getSession } from "../server/auth.js";

/**
 * Resolve the session ID for app state scoping.
 * - Dev mode: returns "local" (backward-compatible with existing dev databases)
 * - Production with Google OAuth: returns the user's email
 * - Production with token auth: returns "user" (single-user, same as before)
 */
async function getSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session) return "local";
  // Dev mode returns "local@localhost" — keep using "local" for compat
  if (session.email === "local@localhost") return "local";
  return session.email;
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "");
}

// --- Generic state handlers ---

export const getState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = safeKey(String(getRouterParam(event, "key")));
  const value = await appStateGet(sessionId, key);
  return value ?? null;
});

export const putState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = safeKey(String(getRouterParam(event, "key")));
  const body = await readBody(event);
  await appStatePut(sessionId, key, body);
  return body;
});

export const deleteState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = safeKey(String(getRouterParam(event, "key")));
  await appStateDelete(sessionId, key);
  return { ok: true };
});

// --- Multi-draft compose handlers ---

function composeDraftKey(id: string): string {
  return `compose-${safeKey(id)}`;
}

/** List all compose drafts */
export const listComposeDrafts = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const items = await appStateList(sessionId, "compose-");
  return items.map((item) => item.value);
});

/** Get a single compose draft */
export const getComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  const value = await appStateGet(sessionId, composeDraftKey(id));
  return value ?? null;
});

/** Create or update a compose draft */
export const putComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  const body = await readBody(event);
  const { subject, body: bodyText } = body;

  if (typeof subject !== "string" || typeof bodyText !== "string") {
    setResponseStatus(event, 400);
    return { error: "subject and body are required strings" };
  }

  const state = { ...body, id };
  await appStatePut(sessionId, composeDraftKey(id), state);
  return state;
});

/** Delete a single compose draft */
export const deleteComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  await appStateDelete(sessionId, composeDraftKey(id));
  return { ok: true };
});

/** Delete all compose drafts */
export const deleteAllComposeDrafts = defineEventHandler(
  async (event: H3Event) => {
    const sessionId = await getSessionId(event);
    await appStateDeleteByPrefix(sessionId, "compose-");
    return { ok: true };
  },
);
