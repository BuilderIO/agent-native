import { lookupGongCallsByEmail } from "@agent-native/core/provider-api/gong";
import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  integrationContextFor,
  readIntegrationKey,
} from "../lib/integration-keys.js";

export const gongValidate = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event).catch(() => ({}));
  const apiKey = (body as { apiKey?: unknown })?.apiKey;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { valid: false, error: "apiKey is required" };
  }
  const authHeaders = [
    `Bearer ${apiKey}`,
    `Basic ${Buffer.from(apiKey).toString("base64")}`,
  ];
  let lastStatus = 0;
  for (const auth of authHeaders) {
    try {
      const response = await fetch("https://api.gong.io/v2/users?limit=1", {
        headers: { Authorization: auth },
      });
      if (response.ok) return { valid: true };
      lastStatus = response.status;
      if (response.status !== 401 && response.status !== 403) break;
    } catch {
      setResponseStatus(event, 502);
      return { valid: false, error: "Could not reach Gong to verify the key." };
    }
  }
  if (lastStatus === 401 || lastStatus === 403) {
    setResponseStatus(event, lastStatus);
    return { valid: false, error: "Invalid Gong API key." };
  }
  setResponseStatus(event, lastStatus || 502);
  return {
    valid: false,
    error: lastStatus
      ? `Gong API returned ${lastStatus}.`
      : "Could not reach Gong to verify the key.",
  };
});

async function getGongKey(event: H3Event): Promise<string | undefined> {
  return readIntegrationKey("gong", await integrationContextFor(event));
}

export const gongCallsLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = await getGongKey(event);
  if (!apiKey) {
    setResponseStatus(event, 401);
    return { error: "Gong API key not configured" };
  }

  const result = await lookupGongCallsByEmail({ credential: apiKey, email });
  if (!result.ok) {
    setResponseStatus(event, result.status);
    return { error: result.error };
  }
  return result.calls;
});
