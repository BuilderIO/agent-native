import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, inArray } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { serializeGenerationSession } from "./_helpers.js";
import { GENERATION_SESSION_STATUSES } from "../shared/api.js";

function assertUniqueIds(ids: string[], label: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`${label} contains duplicate id ${id}.`);
    }
    seen.add(id);
  }
}

export default defineAction({
  description:
    "Update a generation handoff session, add candidate assets/runs, record feedback, or mark the selected asset.",
  schema: z.object({
    id: z.string(),
    title: z.string().min(1).optional(),
    brief: z.string().nullable().optional(),
    status: z.enum(GENERATION_SESSION_STATUSES).optional(),
    activeAssetId: z.string().nullable().optional(),
    feedback: z.string().optional(),
    assetIds: z.array(z.string()).optional(),
    runIds: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  run: async ({ id, assetIds, runIds, feedback, metadata, ...args }) => {
    const db = getDb();
    const [session] = await db
      .select()
      .from(schema.assetGenerationSessions)
      .where(eq(schema.assetGenerationSessions.id, id))
      .limit(1);
    if (!session) throw new Error("Generation session not found.");
    await assertAccess("asset-library", session.libraryId, "editor");
    const now = nowIso();
    if (args.activeAssetId === "") {
      throw new Error("activeAssetId must be a valid asset id or null.");
    }
    const activeAssetId = args.activeAssetId ?? null;
    const inputAssetIds = [...(assetIds ?? [])];
    const inputRunIds = [...(runIds ?? [])];
    assertUniqueIds(inputAssetIds, "assetIds");
    assertUniqueIds(inputRunIds, "runIds");

    const existingItems = await db
      .select({
        assetId: schema.assetGenerationSessionItems.assetId,
        generationRunId: schema.assetGenerationSessionItems.generationRunId,
      })
      .from(schema.assetGenerationSessionItems)
      .where(eq(schema.assetGenerationSessionItems.sessionId, id));
    const existingAssetIds = new Set(
      existingItems
        .map((item) => item.assetId)
        .filter((assetId): assetId is string => Boolean(assetId)),
    );
    const existingRunIds = new Set(
      existingItems
        .map((item) => item.generationRunId)
        .filter((runId): runId is string => Boolean(runId)),
    );
    const duplicateAssetId = (assetIds ?? []).find((assetId) =>
      existingAssetIds.has(assetId),
    );
    if (duplicateAssetId) {
      throw new Error(
        `Asset ${duplicateAssetId} is already in this generation session.`,
      );
    }
    const duplicateRunId = (runIds ?? []).find((runId) =>
      existingRunIds.has(runId),
    );
    if (duplicateRunId) {
      throw new Error(
        `Generation run ${duplicateRunId} is already in this generation session.`,
      );
    }
    const assetIdsToValidate = [...inputAssetIds];
    if (activeAssetId && !assetIdsToValidate.includes(activeAssetId)) {
      assetIdsToValidate.push(activeAssetId);
    }
    const runIdsToValidate = inputRunIds;
    const uniqueAssetIds = [...inputAssetIds];
    if (activeAssetId && !existingAssetIds.has(activeAssetId)) {
      if (!uniqueAssetIds.includes(activeAssetId)) {
        uniqueAssetIds.push(activeAssetId);
      }
    }
    const uniqueRunIds = inputRunIds;

    if (assetIdsToValidate.length) {
      const assets = await db
        .select({ id: schema.assets.id, libraryId: schema.assets.libraryId })
        .from(schema.assets)
        .where(inArray(schema.assets.id, assetIdsToValidate));
      const foundIds = new Set(assets.map((asset) => asset.id));
      if (assets.some((asset) => asset.libraryId !== session.libraryId)) {
        throw new Error("All assets must belong to this asset library.");
      }
      for (const assetId of assetIdsToValidate) {
        if (!foundIds.has(assetId)) {
          throw new Error(`Asset ${assetId} was not found.`);
        }
      }
    }

    if (runIdsToValidate.length) {
      const runs = await db
        .select({
          id: schema.assetGenerationRuns.id,
          libraryId: schema.assetGenerationRuns.libraryId,
        })
        .from(schema.assetGenerationRuns)
        .where(inArray(schema.assetGenerationRuns.id, runIdsToValidate));
      const foundIds = new Set(runs.map((run) => run.id));
      if (runs.some((run) => run.libraryId !== session.libraryId)) {
        throw new Error(
          "All generation runs must belong to this asset library.",
        );
      }
      for (const runId of runIdsToValidate) {
        if (!foundIds.has(runId)) {
          throw new Error(`Generation run ${runId} was not found.`);
        }
      }
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.brief !== undefined) updates.brief = args.brief;
    if (args.status !== undefined) updates.status = args.status;
    if (args.activeAssetId !== undefined) updates.activeAssetId = activeAssetId;
    if (feedback !== undefined) updates.feedbackSummary = feedback;
    const nextMetadata = {
      ...parseJson<Record<string, unknown>>(session.metadata, {}),
      ...(metadata ?? {}),
    };
    if (feedback?.trim()) {
      const history = Array.isArray(nextMetadata.feedbackHistory)
        ? nextMetadata.feedbackHistory
        : [];
      nextMetadata.feedbackHistory = [...history, { at: now, feedback }];
    }
    updates.metadata = stringifyJson(nextMetadata);
    await db
      .update(schema.assetGenerationSessions)
      .set(updates)
      .where(eq(schema.assetGenerationSessions.id, id));

    if (uniqueAssetIds.length) {
      for (const assetId of uniqueAssetIds) {
        await db.insert(schema.assetGenerationSessionItems).values({
          id: nanoid(),
          sessionId: id,
          assetId,
          generationRunId: null,
          role: assetId === activeAssetId ? "active" : "candidate",
          note: null,
          sortOrder: 100,
          createdAt: now,
        });
      }
    }
    if (uniqueRunIds.length) {
      for (const runId of uniqueRunIds) {
        await db.insert(schema.assetGenerationSessionItems).values({
          id: nanoid(),
          sessionId: id,
          assetId: null,
          generationRunId: runId,
          role: "run",
          note: null,
          sortOrder: 100,
          createdAt: now,
        });
      }
    }
    return serializeGenerationSession({ ...session, ...updates });
  },
});
