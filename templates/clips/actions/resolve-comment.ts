/**
 * Toggle or set the resolved state on a comment.
 *
 * Usage:
 *   pnpm action resolve-comment --id=<id>             # toggle
 *   pnpm action resolve-comment --id=<id> --resolved=true
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Mark a comment as resolved/unresolved. If --resolved is omitted, toggles the current value.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    resolved: z
      .boolean()
      .optional()
      .describe("Explicit resolved value. Omit to toggle."),
  }),
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    // Any viewer of the recording can resolve a comment (consistent with video-review apps).
    await assertAccess("recording", existing.recordingId, "viewer");

    const next = args.resolved ?? !existing.resolved;
    const now = new Date().toISOString();

    await db
      .update(schema.recordingComments)
      .set({ resolved: next, updatedAt: now })
      .where(eq(schema.recordingComments.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Comment ${args.id} ${next ? "resolved" : "unresolved"}`);
    return { id: args.id, resolved: next };
  },
});
