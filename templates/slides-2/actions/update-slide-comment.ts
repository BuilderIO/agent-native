import {
  defineAction,
  fail,
  type WriteReceipt,
} from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";

export default defineAction({
  description:
    "Update a slide comment. Comment text supports inline Markdown without headings. Resolving or reopening a comment applies to the full thread.",
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
    )
    .refine(
      (args) => !(args.content !== undefined && args.resolved !== undefined),
      {
        message: "Provide either comment content or a resolved state, not both",
        path: ["content"],
      },
    ),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args) => {
    const hasContent = args.content !== undefined;
    const hasResolved = args.resolved !== undefined;
    if (!hasContent && !hasResolved) {
      fail("Provide comment content or a resolved state", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }
    if (hasContent && hasResolved) {
      fail("Provide either comment content or a resolved state, not both", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }

    const access = await assertAccess("deck", args.deckId, "commenter");
    assertSlides2DeckData(access.resource.data);
    const db = getDb();
    const [comment] = await db
      .select({
        deckId: schema.slideComments.deckId,
        slideId: schema.slideComments.slideId,
        threadId: schema.slideComments.threadId,
        authorEmail: schema.slideComments.authorEmail,
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

    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (hasContent && comment.authorEmail.trim().toLowerCase() !== userEmail) {
      await assertAccess("deck", comment.deckId, "editor");
    }

    const updatedAt = new Date().toISOString();
    const setThreadResolved = async (resolved: boolean) => {
      const updatedCount = await db.transaction(async (tx) => {
        // Reply creation takes this same thread lock before checking
        // resolution, so resolution cannot race an insert.
        const threadRows = await tx
          .select({ id: schema.slideComments.id })
          .from(schema.slideComments)
          .where(
            and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.slideId, comment.slideId),
              eq(schema.slideComments.threadId, comment.threadId),
            ),
          )
          .for("update");
        if (!threadRows.some((row) => row.id === args.id)) {
          fail(`Comment not found: ${args.id}`, {
            errorCode: "not_found",
            statusCode: 404,
          });
        }

        const updated = await tx
          .update(schema.slideComments)
          .set({ resolved, updatedAt })
          .where(
            and(
              eq(schema.slideComments.deckId, comment.deckId),
              eq(schema.slideComments.slideId, comment.slideId),
              eq(schema.slideComments.threadId, comment.threadId),
            ),
          )
          .returning({
            id: schema.slideComments.id,
            resolved: schema.slideComments.resolved,
          });

        if (
          updated.length !== threadRows.length ||
          updated.some((row) => row.resolved !== resolved)
        ) {
          fail("Could not verify that the comment thread was updated.", {
            errorCode: "write_not_verified",
            statusCode: 500,
          });
        }
        return updated.length;
      });
      const _receipt: WriteReceipt = {
        changed: true,
        verified: true,
        subject: `${comment.deckId}:${comment.threadId}`,
        summary: `Comment thread ${resolved ? "resolved" : "reopened"}.`,
        checks: [
          {
            id: "comment-thread-resolution",
            ok: true,
            detail: `${updatedCount} comments have the requested resolved state.`,
          },
        ],
      };
      return { ok: true, resolved, _receipt };
    };

    if (args.resolved === true) {
      return setThreadResolved(true);
    }

    if (args.resolved === false) {
      return setThreadResolved(false);
    }

    if (args.content === undefined) {
      fail("Provide comment content or a resolved state", {
        errorCode: "invalid_request",
        statusCode: 400,
      });
    }

    const updated = await db
      .update(schema.slideComments)
      .set({ content: args.content, updatedAt })
      .where(
        and(
          eq(schema.slideComments.id, args.id),
          eq(schema.slideComments.deckId, comment.deckId),
        ),
      )
      .returning({
        id: schema.slideComments.id,
        content: schema.slideComments.content,
      });
    const updatedComment = updated[0];
    if (!updatedComment) {
      fail(`Comment not found: ${args.id}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    if (updatedComment.content !== args.content) {
      fail("Could not verify that the comment was updated.", {
        errorCode: "write_not_verified",
        statusCode: 500,
      });
    }

    const _receipt: WriteReceipt = {
      changed: true,
      verified: true,
      subject: args.id,
      summary: "Comment updated.",
      checks: [
        {
          id: "comment-content",
          ok: true,
          detail: "The saved comment text matches the request.",
        },
      ],
    };
    return { ok: true, _receipt };
  },
});
