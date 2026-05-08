/**
 * Toggle the current user's emoji reaction on a comment.
 *
 * Stores reactions as a JSON map of emoji -> [emails] on the comment row's
 * `emojiReactionsJson` column. Calling with the same emoji twice removes the
 * user from that bucket.
 *
 * Usage:
 *   pnpm action react-to-comment --commentId=<id> --emoji="🔥"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

const MAX_CAS_ATTEMPTS = 3;

export default defineAction({
  description:
    "Toggle the current user's emoji reaction on a comment. Calling with the same emoji twice removes the reaction.",
  schema: z.object({
    commentId: z.string().describe("Comment ID"),
    emoji: z.string().min(1).describe("Emoji character (e.g. 👍, ❤️, 🔥)"),
  }),
  run: async (args) => {
    const db = getDb();
    const viewerEmail = getRequestUserEmail();
    if (!viewerEmail) {
      throw new Error("Sign in required to react to comments.");
    }

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [existing] = await db
        .select()
        .from(schema.recordingComments)
        .where(eq(schema.recordingComments.id, args.commentId))
        .limit(1);
      if (!existing) throw new Error(`Comment not found: ${args.commentId}`);

      if (attempt === 0) {
        await assertAccess("recording", existing.recordingId, "viewer");
      }

      const previousJson = existing.emojiReactionsJson;
      let reactions: Record<string, string[]> = {};
      try {
        const parsed = JSON.parse(previousJson || "{}");
        if (parsed && typeof parsed === "object") {
          reactions = parsed as Record<string, string[]>;
        }
      } catch {
        reactions = {};
      }

      const bucket = Array.isArray(reactions[args.emoji])
        ? reactions[args.emoji]
        : [];
      const had = bucket.includes(viewerEmail);
      const nextBucket = had
        ? bucket.filter((e) => e !== viewerEmail)
        : [...bucket, viewerEmail];

      const next = { ...reactions };
      if (nextBucket.length === 0) {
        delete next[args.emoji];
      } else {
        next[args.emoji] = nextBucket;
      }

      // Compare-and-swap: only commit if the JSON column still matches what
      // we read. A concurrent reaction that landed first will have changed
      // it, so the WHERE will not match and we retry the read-modify-write.
      const updated = await db
        .update(schema.recordingComments)
        .set({
          emojiReactionsJson: JSON.stringify(next),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordingComments.id, args.commentId),
            eq(schema.recordingComments.emojiReactionsJson, previousJson),
          ),
        )
        .returning({ id: schema.recordingComments.id });

      if (updated.length > 0) {
        await writeAppState("refresh-signal", { ts: Date.now() });
        return {
          id: args.commentId,
          emoji: args.emoji,
          reacted: !had,
          reactions: next,
        };
      }
    }

    throw new Error(
      `Could not toggle reaction on comment ${args.commentId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});
