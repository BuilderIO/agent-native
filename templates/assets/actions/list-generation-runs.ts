import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeGenerationRun } from "./_helpers.js";

export default defineAction({
  description: "List recent image and video generation runs for a library.",
  schema: z.object({ libraryId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId }) => {
    await requireLibrary(libraryId);
    const runs = await getDb()
      .select()
      .from(schema.assetGenerationRuns)
      .where(eq(schema.assetGenerationRuns.libraryId, libraryId))
      .orderBy(desc(schema.assetGenerationRuns.createdAt));
    return { count: runs.length, runs: runs.map(serializeGenerationRun) };
  },
});
