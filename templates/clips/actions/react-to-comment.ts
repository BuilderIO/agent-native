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
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Toggle the current user's emoji reaction on a comment. Calling with the same emoji twice removes the reaction.",
  schema: z.object({
    commentId: z.string().describe("Comment ID"),
    emoji: z.string().min(1).describe("Emoji character (e.g. 👍, ❤️, 🔥)"),
  }),
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, args.commentId))
      .limit(1);
    if (!existing) throw new Error(`Comment not found: ${args.commentId}`);

    await assertAccess("recording", existing.recordingId, "viewer");

    const viewerEmail = getRequestUserEmail();
    if (!viewerEmail) {
      throw new Error("Sign in required to react to comments.");
    }

    let reactions: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(existing.emojiReactionsJson || "{}");
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

    const now = new Date().toISOString();
    await db
      .update(schema.recordingComments)
      .set({ emojiReactionsJson: JSON.stringify(next), updatedAt: now })
      .where(eq(schema.recordingComments.id, args.commentId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: args.commentId,
      emoji: args.emoji,
      reacted: !had,
      reactions: next,
    };
  },
});
