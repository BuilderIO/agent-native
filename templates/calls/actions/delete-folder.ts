/**
 * Delete an empty folder. Fails with a helpful error if the folder contains
 * any child folders or any calls.
 *
 * Usage:
 *   pnpm action delete-folder --id=<id>
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
  description:
    "Delete a folder only if it is empty — no child folders and no calls. Throws a helpful error otherwise.",
  schema: z.object({
    id: z.string().min(1).describe("Folder id"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [folder] = await db
      .select()
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, args.id),
          eq(schema.folders.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!folder) throw new Error(`Folder not found: ${args.id}`);

    const [childFolder] = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(eq(schema.folders.parentId, args.id))
      .limit(1);
    if (childFolder) {
      throw new Error(
        `Folder "${folder.name}" is not empty — it contains child folders. Delete or move them first.`,
      );
    }

    const [childCall] = await db
      .select({ id: schema.calls.id })
      .from(schema.calls)
      .where(eq(schema.calls.folderId, args.id))
      .limit(1);
    if (childCall) {
      throw new Error(
        `Folder "${folder.name}" is not empty — it contains calls. Move them out first.`,
      );
    }

    await db.delete(schema.folders).where(eq(schema.folders.id, args.id));

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
