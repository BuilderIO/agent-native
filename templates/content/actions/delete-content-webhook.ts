import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { deleteAppSecret } from "@agent-native/core/secrets";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentWebhookScopeForRow,
  contentWebhookSecretRef,
} from "./_content-webhooks.js";

export default defineAction({
  description:
    "Remove a webhook by ID. Content stops sending its events at once, drops deliveries still waiting to be retried, and deletes its signing secret. Requires admin access to the collection or page it watches.",
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  schema: z.object({
    id: z.string().describe("Webhook ID from create- or list-content-webhooks"),
  }),
  run: async (args) => {
    const db = getDb();
    const [webhook] = await db
      .select()
      .from(schema.contentWebhooks)
      .where(eq(schema.contentWebhooks.id, args.id))
      .limit(1);
    if (!webhook || !(await contentWebhookScopeForRow(webhook))) {
      throw new ActionContractError(`Webhook not found: ${args.id}`, {
        errorCode: "WEBHOOK_NOT_FOUND",
        statusCode: 404,
      });
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.contentWebhookDeliveries)
        .where(
          and(
            eq(schema.contentWebhookDeliveries.webhookId, webhook.id),
            eq(schema.contentWebhookDeliveries.status, "pending"),
          ),
        );
      await tx
        .delete(schema.contentWebhooks)
        .where(eq(schema.contentWebhooks.id, webhook.id));
    });
    await deleteAppSecret(contentWebhookSecretRef(webhook)).catch(
      () => undefined,
    );
    return { ok: true, id: webhook.id };
  },
});
