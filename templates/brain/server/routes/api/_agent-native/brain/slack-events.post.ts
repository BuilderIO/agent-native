import {
  defineEventHandler,
  getHeader,
  readRawBody,
  setResponseStatus,
} from "h3";

import { enqueueSlackThreadRefreshFromEvent } from "../../../../lib/slack-events.js";

export default defineEventHandler(async (event) => {
  const rawBody = (await readRawBody(event)) ?? "";
  const result = await enqueueSlackThreadRefreshFromEvent({
    rawBody,
    timestamp: getHeader(event, "x-slack-request-timestamp"),
    signature: getHeader(event, "x-slack-signature"),
  });

  if (result.status === "invalid") {
    setResponseStatus(event, 401);
    return { ok: false, error: "invalid Slack signature or payload" };
  }
  if (result.status === "missing-signing-secret") {
    setResponseStatus(event, 503);
    return { ok: false, error: "Slack signing secret is not configured" };
  }
  if (result.challenge) return result.challenge;
  return { ok: true };
});
