import { defineAction } from "@agent-native/core";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  requireLibrary,
  serializeAssets,
  serializeGenerationRun,
  serializeLibrary,
} from "./_helpers.js";

export default defineAction({
  description:
    "Get an asset library with folders, collections, reference assets, generated assets, and recent generation runs.",
  schema: z.object({
    id: z.string().describe("Asset library ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }, ctx) => {
    const library = await requireLibrary(id, ctx);
    const db = getDb();
    const [collections, folders, assets, runs] = await Promise.all([
      db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.libraryId, id)),
      db
        .select()
        .from(schema.assetFolders)
        .where(eq(schema.assetFolders.libraryId, id)),
      db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.libraryId, id))
        .orderBy(desc(schema.assets.createdAt)),
      db
        .select()
        .from(schema.assetGenerationRuns)
        .where(eq(schema.assetGenerationRuns.libraryId, id))
        .orderBy(desc(schema.assetGenerationRuns.createdAt)),
    ]);
    return {
      library: serializeLibrary(library),
      collections,
      folders,
      assets: serializeAssets(assets),
      runs: runs.map(serializeGenerationRun),
    };
  },
});
