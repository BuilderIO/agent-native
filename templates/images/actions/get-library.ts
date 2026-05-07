import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  requireLibrary,
  serializeAsset,
  serializeGenerationRun,
  serializeLibrary,
} from "./_helpers.js";

export default defineAction({
  description:
    "Get an image library with collections, reference images, generated images, and recent generation runs.",
  schema: z.object({
    id: z.string().describe("Image library ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const library = await requireLibrary(id);
    const db = getDb();
    const [collections, assets, runs] = await Promise.all([
      db
        .select()
        .from(schema.imageCollections)
        .where(eq(schema.imageCollections.libraryId, id)),
      db
        .select()
        .from(schema.imageAssets)
        .where(eq(schema.imageAssets.libraryId, id))
        .orderBy(desc(schema.imageAssets.createdAt)),
      db
        .select()
        .from(schema.imageGenerationRuns)
        .where(eq(schema.imageGenerationRuns.libraryId, id))
        .orderBy(desc(schema.imageGenerationRuns.createdAt)),
    ]);
    return {
      library: serializeLibrary(library),
      collections,
      assets: assets.map(serializeAsset),
      runs: runs.map(serializeGenerationRun),
    };
  },
});
