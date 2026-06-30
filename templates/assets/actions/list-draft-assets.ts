import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { serializeAsset } from "./_helpers.js";

export default defineAction({
  description:
    "List unsaved draft generations (generated candidate assets) across accessible libraries, newest first.",
  schema: z.object({
    libraryId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, limit }) => {
    const db = getDb();
    const libraryFilters = [
      accessFilter(schema.assetLibraries, schema.assetLibraryShares),
      isNull(schema.assetLibraries.archivedAt),
    ];
    if (libraryId) libraryFilters.push(eq(schema.assetLibraries.id, libraryId));
    const accessibleLibraries = await db
      .select({ id: schema.assetLibraries.id })
      .from(schema.assetLibraries)
      .where(and(...libraryFilters));
    const libraryIds = accessibleLibraries.map((row) => row.id);
    if (!libraryIds.length) return { count: 0, assets: [] };

    const rows = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          inArray(schema.assets.libraryId, libraryIds),
          eq(schema.assets.role, "generated"),
          eq(schema.assets.status, "candidate"),
        ),
      )
      .orderBy(desc(schema.assets.createdAt))
      .limit(limit ?? 50);

    return {
      count: rows.length,
      assets: rows.map((row) => serializeAsset(row)),
    };
  },
});
