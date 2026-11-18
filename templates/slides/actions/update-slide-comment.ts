import { defineAction, fail } from "@agent-native/core/action";
import { ensureReviewTables } from "@agent-native/core/review";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mirrorSlideComments } from "../server/lib/slide-comment-mirror.js";

export default defineAction({
  description:
    "Update a slide comment. Comment text supports inline Markdown without headings. content and resolved can be sent together. A resolved change applies to the full thread; sending the current resolved value leaves the thread unchanged.",
  schema: z
    .object({
      id: z.string().describe("Comment ID"),
      deckId: z.string().describe("Deck ID"),
      content: z.string().trim().min(1).optional().describe("New comment text"),
      resolved: z.boolean().optional().describe("Resolved state"),
    })
    .refine(
      (args) => args.content !== undefined || args.resolved !== undefined,
      "Provide comment content or a resolved state",
    ),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  run: async (args) => {
    const hasContent = args.content !== undefined;
    if (!hasContent && args.resolved === undefined) {
      fail("Provide comment content or a resolved state", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }

    await assertAccess("deck", args.deckId, "commenter");
    const db = getDb();
    const [comment] = await db
      .select({
        deckId: schema.slideComments.deckId,
        slideId: schema.slideComments.slideId,
        threadId: schema.slideComments.threadId,
        authorEmail: schema.slideComments.authorEmail,
        resolved: schema.slideComments.resolved,
      })
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.id, args.id),
          eq(schema.slideComments.deckId, args.deckId),
        ),
      )
      .limit(1);

    if (!comment) {
      fail(`Comment not found: ${args.id}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const nextResolved =
      args.resolved !== undefined && args.resolved !== comment.resolved
        ? args.resolved
        : undefined;

    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (hasContent && comment.authorEmail.trim().toLowerCase() !== userEmail) {
      await assertAccess("deck", comment.deckId, "editor");
    }

    // Sending the thread's current resolved state alone changes nothing.
    if (args.content === undefined && nextResolved === undefined) {
      return { ok: true };
    }

    const updatedAt = new Date().toISOString();
    await ensureReviewTables();
    await db.transaction(async (tx) => {
      // Adding and deleting comments lock the deck first, as does the copy
      // into the review kit, so a reply can't land partway through resolving
      // its thread, and the copy never waits on rows this holds.
      await tx
        .select({ id: schema.decks.id })
        .from(schema.decks)
        .where(eq(schema.decks.id, comment.deckId))
        .for("update");
      const changedIds = new Set<string>();

      if (args.content !== undefined) {
        const updated = await tx
          .update(schema.slideComments)
          .set({ content: args.content, updatedAt })
          .where(
            and(
              eq(schema.slideComments.id, args.id),
              eq(schema.slideComments.deckId, comment.deckId),
            ),
          )
          .returning({ id: schema.slideComments.id });
        if (updated.length === 0) {
          fail(`Comment not found: ${args.id}`, {
            errorCode: "not_found",
            statusCode: 404,
          });
        }
        changedIds.add(args.id);
      }

      if (nextResolved !== undefined) {
        const resolvedRows = await tx
          .update(schema.slideComments)
          .set({ resolved: nextResolved, updatedAt })
          .where(
            and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.slideId, comment.slideId),
              eq(schema.slideComments.threadId, comment.threadId),
            ),
          )
          .returning({ id: schema.slideComments.id });
        for (const row of resolvedRows) changedIds.add(row.id);
      }

      await mirrorSlideComments(tx, comment.deckId, [...changedIds]);
    });

    if (nextResolved !== undefined) {
      return { ok: true, resolved: nextResolved };
    }

    return { ok: true };
  },
});
