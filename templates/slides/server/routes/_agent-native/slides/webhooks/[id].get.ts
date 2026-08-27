import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import { getWebhookSubscription } from "../../../../lib/outbound-webhooks.js";

export default defineEventHandler(async (event) => {
  const ownerEmail = getRequestUserEmail();
  const id = getRouterParam(event, "id");
  if (!ownerEmail) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const subscription = id
    ? await getWebhookSubscription(id, ownerEmail, getRequestOrgId() ?? null)
    : null;
  if (!subscription) {
    setResponseStatus(event, 404);
    return { error: "Webhook subscription not found" };
  }
  return subscription;
});
