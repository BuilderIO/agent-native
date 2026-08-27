import {
  extractInternalBearerToken,
  verifyInternalToken,
} from "@agent-native/core/server";
import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { z } from "zod";

import { processDueWebhookDeliveries } from "../../../../lib/outbound-webhooks.js";

export default defineEventHandler(async (event) => {
  const body = z
    .object({ taskId: z.string().min(1) })
    .parse(await readBody(event));
  const token = extractInternalBearerToken(getHeader(event, "authorization"));
  if (!token || !verifyInternalToken(body.taskId, token)) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  return { processed: await processDueWebhookDeliveries() };
});
