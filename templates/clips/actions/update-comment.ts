/**
 * Update the text of a comment.
 *
 * Usage:
 *   pnpm action update-comment --id=<id> --content="Updated text"
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveCommentMentions } from "../server/lib/comment-mentions.js";
import { isRecordingExpired } from "../server/lib/recording-page-access.js";
import { sameOwnerEmail } from "../server/lib/recordings.js";

const mentionSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
});

export default defineAction({
  description:
    "Update a comment's text. Inline Markdown is supported without headings. Only the comment author can edit it.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    content: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Updated comment text; inline Markdown is supported, without headings",
      ),
    mentions: z
      .union([z.string(), z.array(mentionSchema).max(20)])
      .optional()
      .describe("Organization members mentioned in the updated comment"),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in required to edit comments.");
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    // Any signed-in viewer with access to the recording may edit their own
    // comment, matching add-comment's top-level comment gate.
    const access = await assertAccess(
      "recording",
      existing.recordingId,
      "viewer",
    );
    if (
      isRecordingExpired((access.resource as { expiresAt?: string }).expiresAt)
    ) {
      throw new ForbiddenError("Recording has expired");
    }

    if (!sameOwnerEmail(existing.authorEmail, userEmail)) {
      throw new ForbiddenError(
        "Only the comment author can edit this comment.",
      );
    }

    const mentions = await resolveCommentMentions(
      args.mentions,
      existing.organizationId,
    );

    const updatedAt = new Date().toISOString();
    const updated = await db
      .update(schema.recordingComments)
      .set({
        content: args.content,
        mentionsJson: mentions.length > 0 ? JSON.stringify(mentions) : null,
        updatedAt,
      })
      .where(
        and(
          eq(schema.recordingComments.id, args.id),
          eq(schema.recordingComments.content, existing.content),
        ),
      )
      .returning({ id: schema.recordingComments.id });

    if (updated.length === 0) {
      throw new Error(
        `Comment ${args.id} changed before this edit could be saved. Refresh and try again.`,
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id, content: args.content, updatedAt };
  },
});
