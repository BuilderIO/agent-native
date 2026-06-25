import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso } from "../server/lib/json.js";

export default defineAction({
  description:
    "Create a folder inside an asset library for organizing uploaded and generated images or videos.",
  schema: z.object({
    libraryId: z.string(),
    parentId: z.string().nullable().optional(),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
  }),
  run: async ({ libraryId, parentId, title, description }) => {
    await assertAccess("asset-library", libraryId, "editor");
    if (parentId) {
      const [parent] = await getDb()
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.id, parentId))
        .limit(1);
      if (!parent || parent.libraryId !== libraryId) {
        throw new Error("Parent folder does not belong to this library.");
      }
    }
    const now = nowIso();
    const row = {
      id: nanoid(),
      libraryId,
      parentId: parentId ?? null,
      title: title.trim(),
      description: description?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(schema.assetFolders).values(row);
    return row;
  },
});
