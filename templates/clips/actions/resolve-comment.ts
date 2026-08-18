/**
 * Toggle or set the resolved state on a comment.
 *
 * Usage:
 *   pnpm action resolve-comment --id=<id>             # toggle
 *   pnpm action resolve-comment --id=<id> --resolved=true
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isRecordingExpired } from "../server/lib/recording-page-access.js";
import { sameOwnerEmail } from "../server/lib/recordings.js";

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Mark a comment as resolved/unresolved. If --resolved is omitted, toggles the current value.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    resolved: z
      .union([z.boolean(), cliBoolean])
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

    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in required to resolve comments.");
    }

    const access = await assertAccess(
      "recording",
      existing.recordingId,
      "viewer",
    );
    if (
      isRecordingExpired(
        (access.resource as { expiresAt?: string }).expiresAt,
      )
    ) {
      throw new ForbiddenError("Recording has expired");
    }

    if (!sameOwnerEmail(existing.authorEmail, userEmail)) {
      try {
        await assertAccess("recording", existing.recordingId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          throw new ForbiddenError(
            "Only the comment author or a recording editor can resolve this comment.",
          );
        }
        throw err;
      }
    }

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
