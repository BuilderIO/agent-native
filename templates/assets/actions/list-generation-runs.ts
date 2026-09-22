import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  resolveDraftReadScope,
  runReadFilter,
} from "../server/lib/library-access.js";
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
    // Runs carry the prompt, settings, and outputs behind a draft, so a
    // below-approver caller sees their own history, not the kit's.
    const scope = await resolveDraftReadScope([libraryId]);
    const runFilter = runReadFilter(scope, schema.assetGenerationRuns);
    const filters = [
      eq(schema.assetGenerationRuns.libraryId, libraryId),
      ...(runFilter ? [runFilter] : []),
    ];
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
