import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  assertOrgAdmin,
  ForbiddenAuditError,
} from "../server/lib/org-admin.js";
import { parseJson } from "../server/lib/json.js";
import { serializeAsset } from "./_helpers.js";

/**
 * Org-admin run-detail audit view.
 *
 * Returns the full run record plus its references (with thumbs and roles),
 * its generated children (with thumbs and saved status), and the parent run
 * if this was a refinement. Cross-references are scoped to the same org/owner
 * scope `assertOrgAdmin()` returned, so a malicious admin can't pivot from a
 * runId in their org to a runId outside their org.
 */
export default defineAction({
  description:
    "Org-admin only. Get the full detail of a single image generation run, including references with thumbnails, generated children with saved status, and parent run for refinements. Use after list-audit-runs to inspect a specific generation.",
  schema: z.object({
    runId: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ runId }) => {
    const scope = await assertOrgAdmin();
    const db = getDb();

    // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
    const [run] = await db
      .select()
      .from(schema.imageGenerationRuns)
      .where(eq(schema.imageGenerationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Generation run not found.");

    // Re-enforce scope on the specific run — defence in depth. If the admin's
    // org is foo and the run belongs to org bar, refuse.
    if (scope.orgId && run.orgId && run.orgId !== scope.orgId) {
      throw new ForbiddenAuditError(
        "Run is not in this admin's org — access denied.",
      );
    }
    if (scope.ownerEmail && run.ownerEmail !== scope.ownerEmail) {
      throw new ForbiddenAuditError("Run is not owned by you — access denied.");
    }

    // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
    const [library] = await db
      .select()
      .from(schema.imageLibraries)
      .where(eq(schema.imageLibraries.id, run.libraryId))
      .limit(1);

    // Resolve references: the IDs are stored as a JSON array on the run.
    const referenceIds = parseJson<string[]>(run.referenceAssetIds, []);
    const referenceAssets = referenceIds.length
      ? await db
          .select()
          .from(schema.imageAssets)
          // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin
          // above. References are evidence the run used.
          .where(
            referenceIds.length === 1
              ? eq(schema.imageAssets.id, referenceIds[0])
              : sql`${schema.imageAssets.id} IN (${sql.join(
                  referenceIds.map((id) => sql`${id}`),
                  sql`, `,
                )})`,
          )
      : [];

    // Resolve child assets — the candidates / saved images this run produced.
    const childAssets = await db
      .select()
      .from(schema.imageAssets)
      // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
      .where(eq(schema.imageAssets.generationRunId, run.id));

    // Parent run, if this was a refinement. The parent assetId is stored
    // in the run's metadata `sourceAssetId` field.
    const meta = parseJson<{
      sourceAssetId?: string;
      slotId?: string;
      settingsUsed?: Record<string, unknown>;
      assetId?: string;
      outputAssetIds?: string[];
      provider?: string;
      providerGenerationId?: string;
      creditsCharged?: number;
    }>(run.metadata, {});
    let parentRun = null as null | {
      runId: string;
      prompt: string;
      model: string;
      createdAt: string;
    };
    if (meta.sourceAssetId) {
      const [parent] = await db
        .select()
        .from(schema.imageAssets)
        // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
        .where(eq(schema.imageAssets.id, meta.sourceAssetId))
        .limit(1);
      if (parent?.generationRunId) {
        const [pr] = await db
          .select({
            id: schema.imageGenerationRuns.id,
            prompt: schema.imageGenerationRuns.prompt,
            model: schema.imageGenerationRuns.model,
            createdAt: schema.imageGenerationRuns.createdAt,
          })
          .from(schema.imageGenerationRuns)
          // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
          .where(eq(schema.imageGenerationRuns.id, parent.generationRunId))
          .limit(1);
        if (pr) {
          parentRun = {
            runId: pr.id,
            prompt: pr.prompt,
            model: pr.model,
            createdAt: pr.createdAt,
          };
        }
      }
    }

    return {
      run: {
        runId: run.id,
        libraryId: run.libraryId,
        libraryTitle: library?.title ?? "Unknown library",
        libraryOwnerEmail: library?.ownerEmail ?? null,
        ownerEmail: run.ownerEmail,
        orgId: run.orgId,
        source: run.source,
        callerAppId: run.callerAppId,
        model: run.model,
        aspectRatio: run.aspectRatio,
        imageSize: run.imageSize,
        groundingMode: run.groundingMode,
        userPrompt: run.prompt,
        compiledPrompt: run.compiledPrompt,
        referenceAssetIds: referenceIds,
        settingsUsed: meta.settingsUsed ?? {
          model: run.model,
          aspectRatio: run.aspectRatio,
          imageSize: run.imageSize,
          groundingMode: run.groundingMode,
        },
        output: {
          assetId: meta.assetId ?? null,
          assetIds: meta.outputAssetIds ?? (meta.assetId ? [meta.assetId] : []),
          provider: meta.provider ?? null,
          providerGenerationId: meta.providerGenerationId ?? null,
          creditsCharged: meta.creditsCharged ?? null,
        },
        status: run.status,
        errorMessage: run.error,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        slotId: meta.slotId ?? null,
        sourceAssetId: meta.sourceAssetId ?? null,
      },
      references: referenceAssets.map(serializeAsset),
      children: childAssets.map(serializeAsset),
      parentRun,
      scope: {
        orgScoped: Boolean(scope.orgId),
        ownerScoped: Boolean(scope.ownerEmail),
      },
    };
  },
});
