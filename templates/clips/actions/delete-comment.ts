/**
 * Delete a comment (and its replies).
 *
 * Usage:
 *   pnpm action delete-comment --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export default defineAction({
  description:
    "Delete a comment. Only the author or an editor/admin on the recording can delete.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    const userEmail = getRequestUserEmail();
    const isAuthor = !!userEmail && existing.authorEmail === userEmail;

    if (!isAuthor) {
      try {
        await assertAccess("recording", existing.recordingId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          throw new ForbiddenError(
            "Only the comment author or a recording editor can delete this comment.",
          );
        }
        throw err;
      }
    }

    // Delete this comment and any direct replies.
    await db
      .delete(schema.recordingComments)
      .where(
        or(
          eq(schema.recordingComments.id, args.id),
          eq(schema.recordingComments.parentId, args.id),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Deleted comment ${args.id}`);
    return { id: args.id };
  },
});

void and;
