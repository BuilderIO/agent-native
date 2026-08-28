import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";

import {
  getWebhookSubscription,
  resolveWebhookRouteCaller,
} from "../../../../lib/outbound-webhooks.js";

export default defineEventHandler(async (event) => {
  const caller = await resolveWebhookRouteCaller(event);
  const id = getRouterParam(event, "id");
  if (!caller) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const subscription = id
    ? await getWebhookSubscription(id, caller.ownerEmail, caller.orgId)
    : null;
  if (!subscription) {
    setResponseStatus(event, 404);
    return { error: "Webhook subscription not found" };
  }
  return subscription;
});
