import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getHubSpotApiKey,
  HubSpotLookupError,
  lookupHubSpotContact,
  validateHubSpotKey,
} from "../lib/hubspot.js";

async function getSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session) return "local";
  return session.email;
}

async function getHubSpotKey(event: H3Event): Promise<string | undefined> {
  const sessionId = await getSessionId(event);
  return getHubSpotApiKey(sessionId);
}

// POST /api/hubspot/validate — verify a key without saving it
export const hubspotValidate = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event).catch(() => ({}));
  const apiKey = (body as { apiKey?: unknown })?.apiKey;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { valid: false, error: "apiKey is required" };
  }
  const result = await validateHubSpotKey(apiKey);
  if (!result.valid) setResponseStatus(event, result.statusCode || 401);
  return result;
});

// GET /api/hubspot/contact?email=...
export const hubspotContactLookup = defineEventHandler(
  async (event: H3Event) => {
    const { email } = getQuery(event);
    if (!email || typeof email !== "string") {
      setResponseStatus(event, 400);
      return { error: "email query param required" };
    }

    const apiKey = await getHubSpotKey(event);
    if (!apiKey) {
      setResponseStatus(event, 401);
      return { error: "HubSpot API key not configured" };
    }

    try {
      return await lookupHubSpotContact(apiKey, email);
    } catch (error) {
      if (error instanceof HubSpotLookupError) {
        setResponseStatus(event, error.statusCode);
        return { error: error.message };
      }

      setResponseStatus(event, 500);
      return { error: "Failed to reach HubSpot API" };
    }
  },
);
