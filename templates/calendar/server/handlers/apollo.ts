import { readBody } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getIntegrationKey,
  saveIntegrationKey,
  deleteIntegrationKey,
} from "../lib/integration-credentials.js";

// GET /api/apollo/status — never returns the key, only connection state.
export const apolloStatus = defineEventHandler(async (event: H3Event) => {
  return { connected: !!(await getIntegrationKey(event, "apollo")) };
});

// PUT /api/apollo/key — store the key in the encrypted per-user vault.
export const apolloSaveKey = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { error: "apiKey is required" };
  }
  const ok = await saveIntegrationKey(event, "apollo", apiKey);
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Sign in to connect Apollo" };
  }
  return { connected: true };
});

// DELETE /api/apollo/key
export const apolloDeleteKey = defineEventHandler(async (event: H3Event) => {
  const ok = await deleteIntegrationKey(event, "apollo");
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Sign in to disconnect Apollo" };
  }
  return { connected: false };
});

// In-memory cache for Apollo person lookups
const personCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// GET /api/apollo/person?email=...
export const apolloPersonLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = await getIntegrationKey(event, "apollo");
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
