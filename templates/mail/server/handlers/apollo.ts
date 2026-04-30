import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  appStateGet,
  appStatePut,
  appStateDelete,
} from "@agent-native/core/application-state";
import {
  readBody,
  getSession,
  DEV_MODE_USER_EMAIL,
} from "@agent-native/core/server";

async function getSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session) return "local";
  if (session.email === DEV_MODE_USER_EMAIL) return "local";
  return session.email;
}

async function getApolloKey(event: H3Event): Promise<string | undefined> {
  const sessionId = await getSessionId(event);
  const data = await appStateGet(sessionId, "apollo");
  return (data as any)?.apiKey || undefined;
}

// GET /api/apollo/status — check if key is configured (never returns the key itself)
export const apolloStatus = defineEventHandler(async (event: H3Event) => {
  return { connected: !!(await getApolloKey(event)) };
});

// PUT /api/apollo/key — save API key
export const apolloSaveKey = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  const body = await readBody(event);
  const { apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { error: "apiKey is required" };
  }
  await appStatePut(sessionId, "apollo", { apiKey });
  return { connected: true };
});

// DELETE /api/apollo/key — remove API key
export const apolloDeleteKey = defineEventHandler(async (event: H3Event) => {
  const sessionId = await getSessionId(event);
  await appStateDelete(sessionId, "apollo");
  return { connected: false };
});

// In-memory cache for Apollo person lookups — avoids redundant API calls
// when flipping through emails from the same person.
const personCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// GET /api/apollo/person?email=... — look up a person
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

  // Return cached result if still fresh
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

    // Cache the result
    personCache.set(email, { data: person, expiry: Date.now() + CACHE_TTL });

    return person;
  } catch {
    setResponseStatus(event, 500);
    return { error: "Failed to reach Apollo API" };
  }
});
