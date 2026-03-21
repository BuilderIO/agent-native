import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";

// Store Apollo API key in application-state/ (gitignored), NOT in data/settings.json
const STATE_DIR = path.join(process.cwd(), "application-state");
const APOLLO_FILE = path.join(STATE_DIR, "apollo.json");

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function getApolloKey(): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(APOLLO_FILE, "utf-8"));
    return data.apiKey || undefined;
  } catch {
    return undefined;
  }
}

// GET /api/apollo/status — check if key is configured (never returns the key itself)
export const apolloStatus = defineEventHandler((_event: H3Event) => {
  return { connected: !!getApolloKey() };
});

// PUT /api/apollo/key — save API key
export const apolloSaveKey = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { error: "apiKey is required" };
  }
  ensureStateDir();
  fs.writeFileSync(APOLLO_FILE, JSON.stringify({ apiKey }, null, 2));
  return { connected: true };
});

// DELETE /api/apollo/key — remove API key
export const apolloDeleteKey = defineEventHandler((_event: H3Event) => {
  try {
    fs.unlinkSync(APOLLO_FILE);
  } catch {
    // didn't exist
  }
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

  const apiKey = getApolloKey();
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
