import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeAsset } from "./_helpers.js";

export default defineAction({
  description: "Get a generation run and all assets produced by that run.",
  schema: z.object({ runId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ runId }) => {
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.imageGenerationRuns)
      .where(eq(schema.imageGenerationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Generation run not found.");
    await requireLibrary(run.libraryId);
    const assets = await db
      .select()
      .from(schema.imageAssets)
      .where(eq(schema.imageAssets.generationRunId, runId));
    return { run, assets: assets.map(serializeAsset) };
  },
});
