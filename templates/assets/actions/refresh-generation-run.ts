import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  requireLibrary,
  serializeAsset,
  serializeGenerationRun,
} from "./_helpers.js";
import { completeVideoGenerationRun } from "../server/lib/video-runs.js";

export default defineAction({
  description:
    "Refresh a generation run. For video runs, polls the provider operation and creates the video asset once complete.",
  schema: z.object({
    runId: z.string(),
  }),
  run: async ({ runId }) => {
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.assetGenerationRuns)
      .where(eq(schema.assetGenerationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Generation run not found.");
    await requireLibrary(run.libraryId);
    if ((run.mediaType ?? "image") !== "video") {
      return { run: serializeGenerationRun(run), assets: [] };
    }
    if (run.status === "completed") {
      const assets = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.generationRunId, runId));
      return {
        run: serializeGenerationRun(run),
        assets: assets.map(serializeAsset),
      };
    }
    const refreshed = await completeVideoGenerationRun(run);
    return {
      run: serializeGenerationRun(refreshed.run),
      assets:
        refreshed.status === "completed"
          ? [serializeAsset(refreshed.asset)]
          : [],
    };
  },
});
