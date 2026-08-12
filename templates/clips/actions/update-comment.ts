/**
 * Update the text of a comment.
 *
 * Usage:
 *   pnpm action update-comment --id=<id> --content="Updated text"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { sameOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description: "Update a comment's text. Only the comment author can edit it.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    content: z.string().trim().min(1).describe("Updated comment text"),
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

    await assertAccess("recording", existing.recordingId, "commenter");

    if (!sameOwnerEmail(existing.authorEmail, userEmail)) {
      throw new ForbiddenError(
        "Only the comment author can edit this comment.",
      );
    }

    const updatedAt = new Date().toISOString();
    const updated = await db
      .update(schema.recordingComments)
      .set({ content: args.content, updatedAt })
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
