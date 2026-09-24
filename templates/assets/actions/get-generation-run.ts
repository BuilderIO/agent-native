import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  canReadDraftAsset,
  canReadRun,
  resolveDraftReadScope,
} from "../server/lib/library-access.js";
import {
  requireLibrary,
  serializeAsset,
  serializeGenerationRun,
} from "./_helpers.js";

export default defineAction({
  description:
    "Get a generation run and all assets produced by that run for history/debugging. Image generation actions already return completed assets; do not call this just to verify generate-image or generate-image-batch results.",
  schema: z.object({ runId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ runId }) => {
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.assetGenerationRuns)
      .where(eq(schema.assetGenerationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Generation run not found.");
    await requireLibrary(run.libraryId);
    // Same rule as the run list: reading one by id is not a way around it.
    const scope = await resolveDraftReadScope([run.libraryId]);
    if (!canReadRun(scope, run)) {
      throw new Error("Generation run not found.");
    }
    const assets = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.generationRunId, runId));
    return {
      run: serializeGenerationRun(run),
      assets: assets
        .filter((asset) => canReadDraftAsset(scope, asset))
        .map(serializeAsset),
    };
  },
});
