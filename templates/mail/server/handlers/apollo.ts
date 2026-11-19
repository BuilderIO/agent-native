import { appStateDelete } from "@agent-native/core/application-state";
import { readBody } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  deleteIntegrationKey,
  integrationContextFor,
  readIntegrationKey,
  saveIntegrationKey,
} from "../lib/integration-keys.js";

async function getApolloKey(event: H3Event): Promise<string | undefined> {
  return readIntegrationKey("apollo", await integrationContextFor(event));
}

export const apolloStatus = defineEventHandler(async (event: H3Event) => {
  return { connected: !!(await getApolloKey(event)) };
});

export const apolloSaveKey = defineEventHandler(async (event: H3Event) => {
  const ctx = await integrationContextFor(event);
  if (!ctx) {
    setResponseStatus(event, 401);
    return { error: "Sign in to save an API key" };
  }
  const body = await readBody(event);
  const { apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { error: "apiKey is required" };
  }
  await saveIntegrationKey("apollo", apiKey, ctx);
  return { connected: true };
});

export const apolloValidate = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event).catch(() => ({}));
  const apiKey = (body as { apiKey?: unknown })?.apiKey;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { valid: false, error: "apiKey is required" };
  }
  try {
    const response = await fetch("https://api.apollo.io/api/v1/auth/health", {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    if (response.ok) return { valid: true };
    if (response.status === 401 || response.status === 403) {
      setResponseStatus(event, response.status);
      return { valid: false, error: "Invalid Apollo API key." };
    }
    setResponseStatus(event, response.status);
    return { valid: false, error: `Apollo API returned ${response.status}.` };
  } catch {
    setResponseStatus(event, 502);
    return { valid: false, error: "Could not reach Apollo to verify the key." };
  }
});

export const apolloDeleteKey = defineEventHandler(async (event: H3Event) => {
  const ctx = await integrationContextFor(event);
  if (ctx) await deleteIntegrationKey("apollo", ctx);
  await appStateDelete(ctx?.userEmail ?? "local", "apollo");
  return { connected: false };
});

const personCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export const apolloPersonLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = await getApolloKey(event);
  if (!apiKey) {
    setResponseStatus(event, 401);
    return { error: "Apollo API key not configured" };
  }

  const cached = personCache.get(email);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  try {
    const response = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      setResponseStatus(event, response.status);
      return { error: `Apollo API error: ${response.status}` };
    }

    const data = await response.json();
    const person = data.person || null;

    personCache.set(email, { data: person, expiry: Date.now() + CACHE_TTL });

    return person;
  } catch {
    setResponseStatus(event, 500);
    return { error: "Failed to reach Apollo API" };
  }
});
