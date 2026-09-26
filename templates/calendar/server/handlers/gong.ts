import { lookupGongCallsByEmail } from "@agent-native/core/provider-api/gong";
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

export const gongStatus = defineEventHandler(async (event: H3Event) => {
  return { connected: !!(await getIntegrationKey(event, "gong")) };
});

export const gongSaveKey = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { error: "apiKey is required" };
  }
  const ok = await saveIntegrationKey(event, "gong", apiKey);
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Sign in to connect Gong" };
  }
  return { connected: true };
});

export const gongDeleteKey = defineEventHandler(async (event: H3Event) => {
  const ok = await deleteIntegrationKey(event, "gong");
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Sign in to disconnect Gong" };
  }
  return { connected: false };
});

export const gongCallsLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = await getIntegrationKey(event, "gong");
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
