import { readBody } from "@agent-native/core/server";
import {
  SYNTHETIC_TRAFFIC_HEADER,
  isSyntheticTrafficValue,
} from "@agent-native/core/shared";
import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  parseAnalyticsTrackPayload,
  recordAnalyticsEvents,
} from "../lib/first-party-analytics.js";
import { errorReply } from "../lib/request-errors.js";

function setCors(event: any): void {
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Access-Control-Allow-Methods", "POST, OPTIONS");
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    `content-type, x-agent-native-analytics-key, ${SYNTHETIC_TRAFFIC_HEADER.toLowerCase()}`,
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
  if (isSyntheticTrafficValue(getHeader(event, SYNTHETIC_TRAFFIC_HEADER))) {
    setResponseStatus(event, 202);
    return { success: true, accepted: 0 };
  }
  try {
    const parsed = parseAnalyticsTrackPayload(
      await readBody(event),
      getHeader(event, "x-agent-native-analytics-key"),
    );
    const result = await recordAnalyticsEvents(parsed.publicKey, parsed.events);
    setResponseStatus(event, 202);
    return {
      success: true,
      accepted: result.accepted,
      suppressedTestIdentity: result.suppressedTestIdentity,
    };
  } catch (err) {
    const reply = errorReply(err, "[first-party-analytics]");
    setResponseStatus(event, reply.statusCode);
    return { error: reply.error };
  }
});
