import { fireInternalDispatch } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { defineEventHandler, getMethod, readBody, setResponseStatus } from "h3";
import { z } from "zod";

import {
  SLIDES_WEBHOOK_EVENTS,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
  updateWebhookSubscription,
} from "../../../../lib/outbound-webhooks.js";

const createSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (url) => new URL(url).protocol === "https:",
      "Webhook URL must use https",
    ),
  events: z.array(z.enum(SLIDES_WEBHOOK_EVENTS)).min(1),
});
const deleteSchema = z.object({ id: z.string().min(1) });
const updateSchema = createSchema
  .partial()
  .extend({ id: z.string().min(1), enabled: z.boolean().optional() });

export default defineEventHandler(async (event) => {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const orgId = getRequestOrgId() ?? null;
  if (getMethod(event) === "GET")
    return listWebhookSubscriptions(ownerEmail, orgId);
  if (getMethod(event) === "POST") {
    const subscription = await createWebhookSubscription({
      ...createSchema.parse(await readBody(event)),
      ownerEmail,
      orgId,
    });
    return subscription;
  }
  if (getMethod(event) === "PATCH") {
    const subscription = await updateWebhookSubscription({
      ...updateSchema.parse(await readBody(event)),
      ownerEmail,
      orgId,
    });
    if (!subscription) {
      setResponseStatus(event, 404);
      return { error: "Webhook subscription not found" };
    }
    return subscription;
  }
  if (getMethod(event) === "DELETE") {
    const { id } = deleteSchema.parse(await readBody(event));
    const deleted = await deleteWebhookSubscription(id, ownerEmail, orgId);
    if (!deleted) {
      setResponseStatus(event, 404);
      return { error: "Webhook subscription not found" };
    }
    return { deleted: true };
  }
  setResponseStatus(event, 405);
  return { error: "Method not allowed" };
});
