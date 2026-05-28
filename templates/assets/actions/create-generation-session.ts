import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { serializeGenerationSession } from "./_helpers.js";

export default defineAction({
  description:
    "Create a share-through-library generation handoff session from a brief, preset, selected assets, or generation runs so another designer can continue the work.",
  schema: z.object({
    libraryId: z.string(),
    title: z.string().min(1),
    brief: z.string().nullable().optional(),
    collectionId: z.string().nullable().optional(),
    presetId: z.string().nullable().optional(),
    activeAssetId: z.string().nullable().optional(),
    assetIds: z.array(z.string()).optional(),
    runIds: z.array(z.string()).optional(),
    feedback: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  run: async (args) => {
    await assertAccess("asset-library", args.libraryId, "editor");
    const db = getDb();
    if (args.collectionId) {
      const [collection] = await db
        .select()
        .from(schema.assetCollections)
        .where(eq(schema.assetCollections.id, args.collectionId))
        .limit(1);
      if (!collection || collection.libraryId !== args.libraryId) {
        throw new Error("Collection does not belong to this asset library.");
      }
    }
    let preset: typeof schema.assetGenerationPresets.$inferSelect | null = null;
    if (args.presetId) {
      const [row] = await db
        .select()
        .from(schema.assetGenerationPresets)
        .where(eq(schema.assetGenerationPresets.id, args.presetId))
        .limit(1);
      preset = row ?? null;
      if (!preset || preset.libraryId !== args.libraryId) {
        throw new Error("Generation preset does not belong to this library.");
      }
      if (
        args.collectionId &&
        preset.collectionId &&
        preset.collectionId !== args.collectionId
      ) {
        throw new Error("Generation preset belongs to a different collection.");
      }
    }
    const assetIds = [...new Set(args.assetIds ?? [])];
    if (args.activeAssetId && !assetIds.includes(args.activeAssetId)) {
      assetIds.unshift(args.activeAssetId);
    }
    if (assetIds.length) {
      const assets = await db
        .select({ id: schema.assets.id, libraryId: schema.assets.libraryId })
        .from(schema.assets)
        .where(inArray(schema.assets.id, assetIds));
      const foundIds = new Set(assets.map((asset) => asset.id));
      const missing = assetIds.find((assetId) => !foundIds.has(assetId));
      if (missing) throw new Error(`Asset ${missing} was not found.`);
      if (assets.some((asset) => asset.libraryId !== args.libraryId)) {
        throw new Error("All assets must belong to this asset library.");
      }
    }
    const runIds = [...new Set(args.runIds ?? [])];
    if (runIds.length) {
      const runs = await db
        .select({
          id: schema.assetGenerationRuns.id,
          libraryId: schema.assetGenerationRuns.libraryId,
        })
        .from(schema.assetGenerationRuns)
        .where(inArray(schema.assetGenerationRuns.id, runIds));
      const foundIds = new Set(runs.map((run) => run.id));
      const missing = runIds.find((runId) => !foundIds.has(runId));
      if (missing) throw new Error(`Generation run ${missing} was not found.`);
      if (runs.some((run) => run.libraryId !== args.libraryId)) {
        throw new Error(
          "All generation runs must belong to this asset library.",
        );
      }
    }

    const now = nowIso();
    const session = {
      id: nanoid(),
      libraryId: args.libraryId,
      collectionId: args.collectionId ?? preset?.collectionId ?? null,
      presetId: args.presetId ?? null,
      title: args.title,
      brief: args.brief ?? null,
      status: "open",
      activeAssetId: args.activeAssetId ?? assetIds[0] ?? null,
      feedbackSummary: args.feedback ?? "",
      metadata: stringifyJson({
        ...(args.metadata ?? {}),
        feedbackHistory: args.feedback
          ? [{ at: now, feedback: args.feedback }]
          : [],
      }),
      createdBy: getRequestUserEmail() ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(schema.assetGenerationSessions).values(session);
    let sortOrder = 0;
    for (const assetId of assetIds) {
      await db.insert(schema.assetGenerationSessionItems).values({
        id: nanoid(),
        sessionId: session.id,
        assetId,
        generationRunId: null,
        role: assetId === session.activeAssetId ? "active" : "candidate",
        note: null,
        sortOrder,
        createdAt: now,
      });
      sortOrder += 10;
    }
    for (const runId of runIds) {
      await db.insert(schema.assetGenerationSessionItems).values({
        id: nanoid(),
        sessionId: session.id,
        assetId: null,
        generationRunId: runId,
        role: "run",
        note: null,
        sortOrder,
        createdAt: now,
      });
      sortOrder += 10;
    }
    return serializeGenerationSession(session);
  },
});
