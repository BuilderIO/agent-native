import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertMentionsInText,
  submittedCommentMentions,
} from "../server/lib/comment-mention-input.js";
import { notifyEditedCommentMentions } from "../server/lib/comment-notifications.js";
import { commentSubmissionSource } from "../server/lib/comment-submission-source.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  personMentions,
  readStoredCommentMentions,
  serializeStoredCommentMentions,
} from "../shared/comment-mentions.js";

export default defineAction({
  description:
    "Update one exact document comment by ID. Provide content, mentions, resolved, or a combination; calls without a mutation fail. Comment text supports inline Markdown without headings. Resolving or reopening applies to the full thread; include documentId to fail closed on a mismatched pair.",
  mcpTool: true,
  schema: z.object({
    id: z.string().describe("Comment ID"),
    documentId: z.string().optional().describe("Document ID"),
    content: z.string().optional().describe("New comment text"),
    mentions: z
      .union([z.string(), z.array(z.unknown())])
      .optional()
      .describe(
        'JSON-encoded mentions, one per @name in the final text in text order; omitted, the stored mentions must still match it. People: {"email","name"}; agents: {"kind":"agent","model","name"}. A malformed list, or an entry no @name in the final text reaches, is rejected with a 400. People the edit newly mentions are emailed.',
      ),
    resolved: z.coerce.boolean().optional().describe("Resolved state"),
  }),
  run: async (args, ctx) => {
    if (
      args.content === undefined &&
      args.mentions === undefined &&
      args.resolved === undefined
    ) {
      throw new Error(
        "Provide content, mentions, or resolved to update a comment",
      );
    }

    const db = getDb();
    const [comment] = await db
      .select({
        documentId: schema.documentComments.documentId,
        threadId: schema.documentComments.threadId,
        authorEmail: schema.documentComments.authorEmail,
        content: schema.documentComments.content,
        mentionsJson: schema.documentComments.mentionsJson,
      })
      .from(schema.documentComments)
      .where(eq(schema.documentComments.id, args.id))
      .limit(1);

    if (
      !comment ||
      (args.documentId && comment.documentId !== args.documentId)
    ) {
      throw new Error(`Comment not found: ${args.id}`);
    }

    const userEmail = getRequestUserEmail();
    const isAuthor =
      typeof userEmail === "string" &&
      comment.authorEmail.trim().toLowerCase() ===
        userEmail.trim().toLowerCase();
    const access = await assertAccess(
      "document",
      comment.documentId,
      args.resolved === true || args.resolved === false || !isAuthor
        ? "editor"
        : "commenter",
    );
    // guard:allow-bare-error — invariant: assertAccess refuses a signed-out caller
    if (!userEmail) throw new Error("no authenticated user");

    const updatedAt = new Date().toISOString();
    const mentions =
      args.mentions === undefined
        ? undefined
        : submittedCommentMentions(args.mentions);
    const storedMentions = readStoredCommentMentions(comment.mentionsJson);
    if (args.content !== undefined || mentions !== undefined) {
      assertMentionsInText(
        args.content ?? comment.content,
        mentions ?? storedMentions,
      );
    }
    const alreadyMentioned = new Set(
      personMentions(storedMentions).map((mention) =>
        mention.email.trim().toLowerCase(),
      ),
    );
    const addedMentions = personMentions(mentions ?? []).filter(
      (mention) => !alreadyMentioned.has(mention.email.trim().toLowerCase()),
    );
    const contentUpdates: Partial<typeof schema.documentComments.$inferInsert> =
      {
        updatedAt,
        ...(args.content !== undefined ? { content: args.content } : {}),
        ...(mentions !== undefined
          ? {
              mentionsJson: serializeStoredCommentMentions(mentions),
            }
          : {}),
      };

    if (args.resolved !== undefined) {
      await db.transaction(async (tx) => {
        await tx
          .select({ id: schema.documentComments.id })
          .from(schema.documentComments)
          .where(
            and(
              eq(schema.documentComments.id, comment.threadId),
              eq(schema.documentComments.documentId, comment.documentId),
            ),
          )
          .limit(1)
          .for("update");
        if (args.content !== undefined || args.mentions !== undefined) {
          await tx
            .update(schema.documentComments)
            .set(contentUpdates)
            .where(
              and(
                eq(schema.documentComments.id, args.id),
                eq(schema.documentComments.documentId, comment.documentId),
              ),
            );
        }
        await tx
          .update(schema.documentComments)
          .set({ resolved: args.resolved ? 1 : 0, updatedAt })
          .where(
            and(
              eq(schema.documentComments.documentId, comment.documentId),
              eq(schema.documentComments.threadId, comment.threadId),
            ),
          );
      });
    } else {
      await db
        .update(schema.documentComments)
        .set(contentUpdates)
        .where(
          and(
            eq(schema.documentComments.id, args.id),
            eq(schema.documentComments.documentId, comment.documentId),
          ),
        );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    // The email names whoever made the edit: an editor can add a mention to
    // someone else's comment.
    const notified = addedMentions.length
      ? await notifyEditedCommentMentions({
          documentId: comment.documentId,
          documentTitle: (access.resource.title as string | null) ?? "",
          orgId: (access.resource.orgId as string | null) ?? null,
          threadId: comment.threadId,
          ownerEmail: access.resource.ownerEmail as string,
          authorEmail: userEmail,
          authorName: getRequestUserName(),
          submissionSource: commentSubmissionSource(ctx?.caller),
          content: args.content ?? comment.content,
          mentions: addedMentions,
          isReply: comment.threadId !== args.id,
        })
      : undefined;
    return {
      ok: true,
      ...(args.resolved !== undefined ? { resolved: args.resolved } : {}),
      documentId: comment.documentId,
      ...(notified ? { notified } : {}),
    };
  },
  changeResource: (input, result) =>
    documentChangeResource(input.documentId ?? result.documentId),
});
