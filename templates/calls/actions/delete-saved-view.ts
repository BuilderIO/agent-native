/**
 * Delete a saved library view. Owner-only.
 *
 * Usage:
 *   pnpm action delete-saved-view --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
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
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description: "Delete a saved library view. Owner-only.",
  schema: z.object({
    id: z.string().describe("Saved view id"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.savedViews)
      .where(
        and(
          eq(schema.savedViews.id, args.id),
          eq(schema.savedViews.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!existing) throw new Error(`Saved view not found: ${args.id}`);

    await db
      .delete(schema.savedViews)
      .where(
        and(
          eq(schema.savedViews.id, args.id),
          eq(schema.savedViews.ownerEmail, ownerEmail),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, deleted: true };
  },
});

void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
