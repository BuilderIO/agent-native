import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  dispatchWebhookDeliveries,
  enqueueWebhookEvent,
} from "../server/lib/outbound-webhooks.js";

export default defineAction({
  description:
    "Update a slide comment. Comment text supports inline Markdown without headings. Resolving or reopening a comment applies to the full thread.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().optional().describe("Deck ID"),
    content: z.string().optional().describe("New comment text"),
    resolved: z.coerce.boolean().optional().describe("Resolved state"),
  }),
  run: async (args) => {
    const db = getDb();
    const [comment] = await db
      .select()
      .from(schema.slideComments)
      .where(eq(schema.slideComments.id, args.id))
      .limit(1);

    if (!comment || (args.deckId && comment.deckId !== args.deckId)) {
      throw new Error(`Comment not found: ${args.id}`);
    }

    const userEmail = getRequestUserEmail();
    // Resolving or reopening changes state for the whole thread (every
    // author's comments), not just the caller's own row, so it always
    // requires editor access — matching content's update-comment action.
    const access =
      args.resolved === true ||
      args.resolved === false ||
      comment.authorEmail !== userEmail
        ? await assertAccess("deck", comment.deckId, "editor")
        : await assertAccess("deck", comment.deckId, "commenter");
    const scope = {
      ownerEmail: access.resource.ownerEmail as string,
      orgId:
        typeof access.resource.orgId === "string" ? access.resource.orgId : null,
    };

    const updatedAt = new Date().toISOString();

    if (args.resolved === true || args.resolved === false) {
      const resolved = args.resolved;
      const deliveryIds = await db.transaction(async (tx) => {
        await tx
          .update(schema.slideComments)
          .set({ resolved, updatedAt })
          .where(
            and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.threadId, comment.threadId),
            ),
          );
        return enqueueWebhookEvent(
          "comment.updated",
          { ...comment, resolved, updatedAt },
          scope,
          { db: tx },
        );
      });
      await dispatchWebhookDeliveries(deliveryIds);
      return { ok: true, resolved };
    }

    // Both resolve and reopen return early above, so only content edits remain.
    if (args.content === undefined) {
      return { ok: true };
    }

    const deliveryIds = await db.transaction(async (tx) => {
      await tx
        .update(schema.slideComments)
        .set({ content: args.content, updatedAt })
        .where(
          and(
            eq(schema.slideComments.id, args.id),
            eq(schema.slideComments.deckId, comment.deckId),
          ),
        );
      return enqueueWebhookEvent(
        "comment.updated",
        { ...comment, content: args.content, updatedAt },
        scope,
        { db: tx },
      );
    });

    await dispatchWebhookDeliveries(deliveryIds);
    return { ok: true };
  },
});
