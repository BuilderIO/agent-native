import { defineAction } from "@agent-native/core/action";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  requireLibrary,
  serializeAsset,
  serializeTemplate,
  serializeGenerationRun,
  serializeGenerationSession,
} from "./_helpers.js";
import { accessibleTemplateFilter } from "./_template-access.js";

export default defineAction({
  description:
    "Get a generation handoff session with its preset, candidate assets, runs, and feedback context.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const db = getDb();
    const [session] = await db
      .select()
      .from(schema.assetGenerationSessions)
      .where(eq(schema.assetGenerationSessions.id, id))
      .limit(1);
    if (!session) throw new Error("Generation session not found.");
    await requireLibrary(session.libraryId);

    const items = await db
      .select()
      .from(schema.assetGenerationSessionItems)
      .where(eq(schema.assetGenerationSessionItems.sessionId, id))
      .orderBy(
        asc(schema.assetGenerationSessionItems.sortOrder),
        asc(schema.assetGenerationSessionItems.createdAt),
      );
    const assetIds = [
      ...new Set(
        items
          .map((item) => item.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      ),
    ];
    const runIds = [
      ...new Set(
        items
          .map((item) => item.generationRunId)
          .filter((runId): runId is string => Boolean(runId)),
      ),
    ];
    const templateAccess = session.presetId
      ? await accessibleTemplateFilter()
      : null;
    const [presetRows, assets, runs] = await Promise.all([
      session.presetId
        ? db
            .select()
            .from(schema.assetTemplates)
            .where(
              and(
                eq(schema.assetTemplates.id, session.presetId),
                templateAccess!,
              ),
            )
        : Promise.resolve([]),
      assetIds.length
        ? db
            .select()
            .from(schema.assets)
            .where(inArray(schema.assets.id, assetIds))
        : Promise.resolve([]),
      runIds.length
        ? db
            .select()
            .from(schema.assetGenerationRuns)
            .where(inArray(schema.assetGenerationRuns.id, runIds))
        : Promise.resolve([]),
    ]);
    return {
      session: serializeGenerationSession(session),
      preset: presetRows[0] ? serializeTemplate(presetRows[0]) : null,
      items,
      assets: assets.map(serializeAsset),
      runs: runs.map(serializeGenerationRun),
    };
  },
});
