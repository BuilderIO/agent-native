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
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { writeAppState, readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Mark a comment as resolved/unresolved. If resolved is omitted, toggles the current value.",
  schema: z.object({
    id: z.string().describe("Comment id"),
    resolved: z
      .boolean()
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

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
