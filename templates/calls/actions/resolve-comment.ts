/**
 * Toggle or set the resolved state on a comment.
 *
 * Usage:
 *   pnpm action resolve-comment --id=<id>
 *   pnpm action resolve-comment --id=<id> --resolved=true
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Mark a comment as resolved/unresolved. If resolved is omitted, toggles the current value.",
  schema: z.object({
    id: z.string().describe("Comment id"),
    resolved: z
      .union([z.boolean(), cliBoolean])
      .optional()
      .describe("Explicit resolved value — omit to toggle"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.callComments)
      .where(eq(schema.callComments.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    await assertAccess("call", existing.callId, "viewer");

    const next = args.resolved ?? !existing.resolved;
    const now = new Date().toISOString();

    await db
      .update(schema.callComments)
      .set({ resolved: next, updatedAt: now })
      .where(eq(schema.callComments.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Comment ${args.id} ${next ? "resolved" : "unresolved"}`);
    return { id: args.id, resolved: next };
  },
});
