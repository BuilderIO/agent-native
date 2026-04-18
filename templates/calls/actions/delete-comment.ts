/**
 * Delete a comment. Only the author or a call editor/admin can delete.
 *
 * Usage:
 *   pnpm action delete-comment --id=<id>
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
import { ForbiddenError } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Delete a single comment. Only the comment author or a call editor/admin can delete.",
  schema: z.object({
    id: z.string().describe("Comment id"),
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

    const me = getCurrentOwnerEmail();
    const isAuthor = !!me && existing.authorEmail === me;

    if (!isAuthor) {
      try {
        await assertAccess("call", existing.callId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          throw new ForbiddenError(
            "Only the comment author or a call editor can delete this comment.",
          );
        }
        throw err;
      }
    }

    await db
      .delete(schema.callComments)
      .where(eq(schema.callComments.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Deleted comment ${args.id}`);
    return { id: args.id };
  },
});

void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
