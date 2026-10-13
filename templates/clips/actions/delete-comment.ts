import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isRecordingExpiredForViewer } from "../server/lib/recording-page-access.js";

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

    const access = await assertAccess(
      "recording",
      existing.recordingId,
      "viewer",
    );
    if (
      isRecordingExpiredForViewer({
        expiresAt: (access.resource as { expiresAt?: string }).expiresAt,
        viewerIsOwner: access.role === "owner",
      })
    ) {
      throw new ForbiddenError("Recording has expired");
    }

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

    const deletedIds = new Set([existing.id]);
    let frontier = [existing.id];
    while (frontier.length > 0) {
      const children = await db
        .select({ id: schema.recordingComments.id })
        .from(schema.recordingComments)
        .where(
          and(
            inArray(schema.recordingComments.parentId, frontier),
            eq(schema.recordingComments.recordingId, existing.recordingId),
            eq(
              schema.recordingComments.organizationId,
              existing.organizationId,
            ),
          ),
        );
      const nextIds = children
        .map((comment) => comment.id)
        .filter((id) => !deletedIds.has(id));
      nextIds.forEach((id) => deletedIds.add(id));
      frontier = nextIds;
    }

    await db
      .delete(schema.recordingComments)
      .where(
        and(
          inArray(schema.recordingComments.id, Array.from(deletedIds)),
          eq(schema.recordingComments.recordingId, existing.recordingId),
          eq(schema.recordingComments.organizationId, existing.organizationId),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Deleted comment ${args.id}`);
    return { id: args.id, deletedCommentIds: Array.from(deletedIds) };
  },
});
