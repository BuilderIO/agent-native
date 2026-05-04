import {
  createError,
  defineEventHandler,
  getRouterParam,
  getHeader,
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
import { readBody } from "../server/h3-helpers.js";

/**
 * Resolve the session ID for app state scoping. Returns the authenticated
 * user's email; throws 401 when the request has no session.
 */
async function getSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthenticated",
    });
  }
  return session.email;
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_:\-]/g, "");
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
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStatePut(sessionId, key, body, { requestSource });
  return body;
});

export const deleteState = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const key = safeKey(String(getRouterParam(event, "key")));
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStateDelete(sessionId, key, { requestSource });
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
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStatePut(sessionId, composeDraftKey(id), state, { requestSource });
  return state;
});

/** Delete a single compose draft */
export const deleteComposeDraft = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const id = getRouterParam(event, "id") as string;
  const requestSource = getHeader(event, "x-request-source") || undefined;
  await appStateDelete(sessionId, composeDraftKey(id), { requestSource });
  return { ok: true };
});

/** Delete all compose drafts */
export const deleteAllComposeDrafts = defineEventHandler(
  async (event: H3Event) => {
    const sessionId = await getSessionId(event);
    const requestSource = getHeader(event, "x-request-source") || undefined;
    await appStateDeleteByPrefix(sessionId, "compose-", { requestSource });
    return { ok: true };
  },
);
