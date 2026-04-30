import { defineAction } from "@agent-native/core";
import { desc, inArray } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description:
    "List all library folders accessible to the current user, with the composition IDs filed into each.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();

    const folderRows = await db
      .select()
      .from(schema.folders)
      .where(accessFilter(schema.folders, schema.folderShares))
      .orderBy(desc(schema.folders.createdAt));

    let memberships: { folderId: string; compositionId: string }[] = [];
    if (folderRows.length > 0) {
      const folderIds = folderRows.map((f) => f.id);
      memberships = await db
        .select({
          folderId: schema.folderMemberships.folderId,
          compositionId: schema.folderMemberships.compositionId,
        })
        .from(schema.folderMemberships)
        .where(inArray(schema.folderMemberships.folderId, folderIds));
    }

    const compositionsByFolder = new Map<string, string[]>();
    for (const m of memberships) {
      const arr = compositionsByFolder.get(m.folderId) ?? [];
      arr.push(m.compositionId);
      compositionsByFolder.set(m.folderId, arr);
    }

    return folderRows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      visibility: row.visibility,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      compositionIds: compositionsByFolder.get(row.id) ?? [],
    }));
  },
});
