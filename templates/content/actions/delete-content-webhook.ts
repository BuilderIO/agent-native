import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { deleteAppSecret } from "@agent-native/core/secrets";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  contentWebhookScopeForRow,
  contentWebhookSecretRef,
} from "./_content-webhooks.js";

export default defineAction({
  description:
    "Remove a webhook by ID. Content stops sending its events at once, deletes its events, sent or waiting, and deletes its signing secret. Requires admin access to the collection or page it watches.",
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
    // The secret goes first: if that fails, the webhook is still there to
    // delete again. A webhook left without its secret sends nothing, and a
    // retry finds no secret and removes the row.
    await deleteAppSecret(contentWebhookSecretRef(webhook));
    await db.transaction(async (tx) => {
      // Sent ones too: they hold page values and comment text, and nothing
      // can list them once the webhook is gone.
      await tx
        .delete(schema.contentWebhookDeliveries)
        .where(eq(schema.contentWebhookDeliveries.webhookId, webhook.id));
      await tx
        .delete(schema.contentWebhooks)
        .where(eq(schema.contentWebhooks.id, webhook.id));
    });
    return { ok: true, id: webhook.id };
  },
});
