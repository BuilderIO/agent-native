import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { readBody } from "@agent-native/core/server";
import {
  parseAnalyticsTrackPayload,
  recordAnalyticsEvents,
} from "../lib/first-party-analytics.js";

function setCors(event: any): void {
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Access-Control-Allow-Methods", "POST, OPTIONS");
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "content-type, x-agent-native-analytics-key",
  );
  setResponseHeader(event, "Access-Control-Max-Age", "86400");
}

export const handleAnalyticsTrackOptions = defineEventHandler((event) => {
  setCors(event);
  setResponseStatus(event, 204);
  return "";
});

export const handleAnalyticsTrack = defineEventHandler(async (event) => {
  setCors(event);
  try {
    const headerKey = getHeader(event, "x-agent-native-analytics-key");
    let body = await readBody(event);
    if (headerKey) {
      if (typeof body === "string" && body.trim()) {
        body = { ...JSON.parse(body), publicKey: headerKey };
      } else if (body && typeof body === "object" && !Array.isArray(body)) {
        body = { ...(body as Record<string, unknown>), publicKey: headerKey };
      } else {
        body = { publicKey: headerKey };
      }
    }
    const parsed = parseAnalyticsTrackPayload(body);
    const result = await recordAnalyticsEvents(parsed.publicKey, parsed.events);
    setResponseStatus(event, 202);
    return { success: true, accepted: result.accepted };
  } catch (err: any) {
    const message = err?.message || String(err);
    const invalidKey = /invalid analytics public key/i.test(message);
    setResponseStatus(event, invalidKey ? 401 : 400);
    return { error: message };
  }
});
