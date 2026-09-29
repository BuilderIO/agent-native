import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

/** A reaction is one short emoji, not free text. */
const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function reactionId(commentId: string, actorEmail: string, reaction: string) {
  return createHash("sha256")
    .update(`${commentId}\0${actorEmail}\0${reaction}`)
    .digest("hex")
    .slice(0, 32);
}

export default defineAction({
  description:
    "Add or remove your emoji reaction on a Page comment or reply. Requires comment access to the document; each person reacts with a given emoji at most once.",
  mcpTool: true,
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    commentId: z.string().min(1).describe("Comment or reply ID"),
    reaction: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .refine((value) => EMOJI_PATTERN.test(value), {
        message: "Reaction must be an emoji",
      })
      .describe("A single emoji, e.g. 👍"),
    active: z
      .boolean()
      .describe("true to add the reaction, false to remove it"),
  }),
  run: async (args) => {
    const access = await assertAccess("document", args.documentId, "commenter");
    const ownerEmail = access.resource.ownerEmail as string;
    const actorEmail = getRequestUserEmail();
    if (!actorEmail)
      fail("A signed-in person is required to react", {
        statusCode: 401,
        errorCode: "unauthenticated",
      });

    const db = getDb();
    const [comment] = await db
      .select({ id: schema.documentComments.id })
      .from(schema.documentComments)
      .where(
        and(
          eq(schema.documentComments.id, args.commentId),
          eq(schema.documentComments.documentId, args.documentId),
          eq(schema.documentComments.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!comment)
      fail(`Comment not found: ${args.commentId}`, {
        statusCode: 404,
        errorCode: "not_found",
      });

    if (args.active) {
      await db
        .insert(schema.documentCommentReactions)
        .values({
          id: reactionId(args.commentId, actorEmail, args.reaction),
          ownerEmail,
          documentId: args.documentId,
          commentId: args.commentId,
          actorEmail,
          reaction: args.reaction,
        })
        .onConflictDoNothing();
    } else {
      await db
        .delete(schema.documentCommentReactions)
        .where(
          and(
            eq(schema.documentCommentReactions.commentId, args.commentId),
            eq(schema.documentCommentReactions.actorEmail, actorEmail),
            eq(schema.documentCommentReactions.reaction, args.reaction),
          ),
        );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      commentId: args.commentId,
      reaction: args.reaction,
      active: args.active,
    };
  },
});
