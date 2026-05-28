import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { requireLibrary, serializeGenerationRun } from "./_helpers.js";

export default defineAction({
  description: "List recent image and video generation runs for a library.",
  schema: z.object({
    libraryId: z.string(),
    sessionId: z.string().optional(),
    presetId: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, sessionId, presetId }) => {
    await requireLibrary(libraryId);
    const filters = [eq(schema.assetGenerationRuns.libraryId, libraryId)];
    if (sessionId)
      filters.push(eq(schema.assetGenerationRuns.sessionId, sessionId));
    if (presetId)
      filters.push(eq(schema.assetGenerationRuns.presetId, presetId));
    const runs = await getDb()
      .select()
      .from(schema.assetGenerationRuns)
      .where(and(...filters))
      .orderBy(desc(schema.assetGenerationRuns.createdAt));
    return { count: runs.length, runs: runs.map(serializeGenerationRun) };
  },
});
