import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertGuestCreateWithinLimits } from "../server/lib/guest-abuse.js";
import {
  isLocalPlanRuntime,
  resolvePlanOrgIdForWrite,
  requirePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  importPlanAssets,
  applyImportedAssets,
} from "../server/lib/plan-assets.js";
import { createPlanVersionSnapshot } from "../server/lib/plan-versions.js";
import { assertRecapWireframesHaveContent } from "../server/lib/visual-recap-validation.js";
import { serializePlanContent } from "../server/plan-content.js";
import { parsePlanMdxFolder, planMdxFileSchema } from "../server/plan-mdx.js";
import { planSaveConflict } from "../server/plan-save-conflict.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  emitPlanCreated,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planKindSchema,
  planPath,
  planSourceSchema,
  planStatusSchema,
  writeEvent,
} from "../server/plans.js";
import { type PlanContent } from "../shared/plan-content.js";
import type { PlanKind } from "../shared/types.js";

const salvagedBlockPrefix = "\u200b__unknown_block__:";

function containsSalvagedBlock(
  blocks: PlanContent["blocks"] | undefined,
): boolean {
  return (
    blocks?.some((block) => {
      if (
        block.type === "callout" &&
        block.data.tone === "warning" &&
        block.data.body.startsWith(salvagedBlockPrefix)
      ) {
        return true;
      }
      if (block.type === "tabs") {
        return block.data.tabs.some((tab) => containsSalvagedBlock(tab.blocks));
      }
      if (block.type === "columns") {
        return block.data.columns.some((column) =>
          containsSalvagedBlock(column.blocks),
        );
      }
      return false;
    }) ?? false
  );
}

/** A revision later than `previous`, even when the clock hasn't moved on. */
function revisionAfter(previous: string): string {
  const current = nowIso();
  return current > previous
    ? current
    : new Date(Date.parse(previous) + 1).toISOString();
}

export default defineAction({
  description:
    "Create or replace a plan from source-control friendly MDX files (repo check-in workflows). Use ONLY when working with exported MDX source files; for live plans prefer update-visual-plan with contentPatches. The MDX folder is the authoring/export surface; the runtime model remains normalized structured JSON. When replacing an existing plan, pass expectedUpdatedAt to guard against concurrent edits.",
  schema: z.object({
    planId: z
      .string()
      .optional()
      .describe("Existing plan ID to replace. Omit to create a new plan."),
    expectedRevision: z
      .string()
      .optional()
      .describe(
        "The same as expectedUpdatedAt, for sending back a save_conflict's details.currentRevision. Its details.current is the structured plan, so redo a source edit on what read-visual-plan-source returns.",
      ),
    expectedUpdatedAt: z
      .string()
      .optional()
      .describe(
        "Optimistic concurrency guard. When provided and replacing an existing plan (planId set), the action errors if the plan's current updatedAt does not match this value, preventing a full re-import from silently clobbering concurrent edits. Omit to skip the check (backward-compatible).",
      ),
    title: z.string().optional().describe("Plan title override."),
    brief: z.string().optional().describe("Plan brief override."),
    kind: planKindSchema
      .optional()
      .describe(
        "Plan kind. Use 'recap' for a read-only code-review recap (recap- id, /recaps/ route, no inline text editing). Defaults to 'plan'.",
      ),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the plan."),
    currentFocus: z
      .string()
      .optional()
      .describe("Current plan focus for the review surface."),
    status: planStatusSchema.optional().default("review"),
    recapIdempotencyKey: z
      .string()
      .optional()
      .describe(
        "Stable recap retry key. Only used when kind='recap' so create-visual-recap can reserve the key during initial insert.",
      ),
    mdx: planMdxFileSchema.describe(
      "Plan source files. plan.mdx holds frontmatter plus markdown/document blocks; canvas.mdx holds optional DesignBoard/Section/Artboard/Screen/Annotation/Connector components. New canvas Screen components must use html/data.html semantic HTML wireframes; nested kit-tree children like FrameScreen/Card/Row/Btn are legacy compatibility only. Optional assets/ holds base64-encoded image assets keyed by filename (png, jpg, gif, webp, svg). Size caps: 2 MB per asset, 10 MB total per plan.",
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Import Visual Plan Source",
    description:
      "Create or replace a visual plan from MDX source files while preserving the normalized runtime model.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan",
      description: "Open an imported Agent-Native Plan review surface.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Plan",
      height: 900,
    }),
  },
  run: async (args) => {
    let previousContent: PlanContent | null | undefined;
    let previousKind: PlanKind | undefined;
    if (args.planId) {
      await assertPlanEditor(args.planId);
      const existing = await loadPlanBundle(args.planId);
      previousContent = existing.plan.content;
      previousKind = existing.plan.kind;
    }
    const effectiveKind = args.kind ?? previousKind ?? "plan";

    let content: Awaited<ReturnType<typeof parsePlanMdxFolder>>;
    try {
      content = await parsePlanMdxFolder(args.mdx, {
        allowStoredLegacyDefaults: previousContent != null,
        salvageInvalidBlocks: effectiveKind === "recap",
        validateAuthoringChangesAgainst: previousContent ?? null,
      });
      if (effectiveKind === "recap") {
        assertRecapWireframesHaveContent(content);
      }
    } catch (err) {
      throw Object.assign(
        new Error(err instanceof Error ? err.message : String(err)),
        { statusCode: 422 },
      );
    }
    const title = args.title ?? content.title ?? "Imported visual plan";
    const brief = args.brief ?? content.brief ?? "Imported from MDX source.";
    const now = nowIso();
    const db = getDb();

    if (args.planId) {
      const expectedRevision = args.expectedRevision ?? args.expectedUpdatedAt;
      if (expectedRevision) {
        const updatedRows = await db
          .update(schema.plans)
          .set({ updatedAt: expectedRevision })
          .where(
            and(
              eq(schema.plans.id, args.planId),
              eq(schema.plans.updatedAt, expectedRevision),
            ),
          )
          .returning({ id: schema.plans.id });
        if (updatedRows.length === 0) {
          throw await planSaveConflict(args.planId);
        }
      }

      const incomingAssets = args.mdx["assets/"];
      if (incomingAssets && Object.keys(incomingAssets).length > 0) {
        const srcByFilename = await importPlanAssets(
          args.planId,
          incomingAssets,
        );
        content = applyImportedAssets(content, srcByFilename);
      }

      await createPlanVersionSnapshot(args.planId, {
        force: true,
        label: "Before source import",
        createdBy: "agent",
      });
      const importedRows = await db
        .update(schema.plans)
        .set({
          title,
          brief,
          ...(args.kind ? { kind: args.kind } : {}),
          source: args.source,
          repoPath: args.repoPath ?? null,
          currentFocus: args.currentFocus ?? "source review",
          ...(args.kind === "recap" && args.recapIdempotencyKey
            ? { recapIdempotencyKey: args.recapIdempotencyKey }
            : {}),
          status: args.status,
          markdown: args.mdx["plan.mdx"],
          content: serializePlanContent(content),
          updatedAt: now,
          approvedAt: args.status === "approved" ? now : null,
        })
        .where(
          and(
            eq(schema.plans.id, args.planId),
            ...(expectedRevision
              ? [eq(schema.plans.updatedAt, expectedRevision)]
              : []),
          ),
        )
        .returning({ id: schema.plans.id });
      if (expectedRevision && importedRows.length === 0) {
        throw await planSaveConflict(args.planId);
      }

      await writeEvent({
        planId: args.planId,
        type: "plan.source.imported",
        message: "Visual plan MDX source imported.",
        createdBy: "agent",
      });

      const bundle = await loadPlanBundle(args.planId);
      const local =
        isLocalPlanRuntime() &&
        !containsSalvagedBlock(bundle.plan.content?.blocks)
          ? await writePlanLocalFiles({
              planId: bundle.plan.id,
              title: bundle.plan.title,
              brief: bundle.plan.brief,
              content: bundle.plan.content,
              url: planPath(bundle.plan.id, bundle.plan.kind),
            })
          : null;
      return {
        ...bundle,
        planId: bundle.plan.id,
        html: buildPlanHtml(bundle),
        path: planPath(bundle.plan.id, bundle.plan.kind),
        url: planPath(bundle.plan.id, bundle.plan.kind),
        ...(local?.written ? { localFiles: local } : {}),
      };
    }

    const requesterEmail = getRequestUserEmail();
    const ownerEmail = requirePlanOwnerEmailForWrite(
      requesterEmail,
      "Importing a visual plan",
    );
    const ownerOrgId = resolvePlanOrgIdForWrite(
      requesterEmail,
      getRequestOrgId(),
    );
    await assertGuestCreateWithinLimits(ownerEmail);

    const kind = args.kind ?? "plan";
    const id = newId(kind);
    await db.insert(schema.plans).values({
      id,
      title,
      brief,
      kind,
      status: args.status,
      source: args.source,
      repoPath: args.repoPath ?? null,
      currentFocus: args.currentFocus ?? "source review",
      html: null,
      markdown: args.mdx["plan.mdx"],
      content: serializePlanContent(content),
      createdAt: now,
      updatedAt: now,
      approvedAt: args.status === "approved" ? now : null,
      ownerEmail,
      orgId: ownerOrgId,
      visibility: "private",
      ...(kind === "recap" && args.recapIdempotencyKey
        ? { recapIdempotencyKey: args.recapIdempotencyKey }
        : {}),
    });

    const warnings: string[] = [];
    const incomingAssetsCreate = args.mdx["assets/"];
    if (incomingAssetsCreate && Object.keys(incomingAssetsCreate).length > 0) {
      const srcByFilename = await importPlanAssets(id, incomingAssetsCreate);
      // The plan is listed from the insert on, so an editor can already have
      // it open, and can save it while the assets upload. Rewrite what the plan
      // holds at a revision only while it still holds that revision, and move
      // the revision, which is what tells an open editor the content changed.
      let base: { content: PlanContent; updatedAt: string } = {
        content,
        updatedAt: now,
      };
      let rewritten = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const written = await db
          .update(schema.plans)
          .set({
            content: serializePlanContent(
              applyImportedAssets(base.content, srcByFilename),
            ),
            updatedAt: revisionAfter(base.updatedAt),
          })
          .where(
            and(
              eq(schema.plans.id, id),
              eq(schema.plans.updatedAt, base.updatedAt),
            ),
          )
          .returning({ id: schema.plans.id });
        if (written.length > 0) {
          rewritten = true;
          break;
        }
        const { plan } = await loadPlanBundle(id);
        // Content that only reads with some blocks salvaged would lose those
        // blocks' stored data if it were written back, so leave it as it is.
        if (!plan.content || containsSalvagedBlock(plan.content.blocks)) break;
        base = { content: plan.content, updatedAt: plan.updatedAt };
      }
      if (!rewritten) {
        const uploaded = Object.entries(srcByFilename)
          .map(([filename, src]) => `assets/${filename} is at ${src}`)
          .join(", ");
        warnings.push(
          `The plan changed while its assets uploaded, so its image links weren't rewritten and still point at assets/ paths. ${uploaded}.`,
        );
      }
    }

    await writeEvent({
      planId: id,
      type: "plan.source.imported",
      message: "Visual plan MDX source imported.",
      createdBy: "agent",
    });

    const bundle = await loadPlanBundle(id);
    emitPlanCreated({
      planId: id,
      title: bundle.plan.title,
      kind: bundle.plan.kind,
      status: bundle.plan.status,
      blockCount: bundle.plan.content?.blocks.length ?? 0,
      ownerEmail: bundle.access.ownerEmail,
    });
    const local =
      isLocalPlanRuntime() &&
      !containsSalvagedBlock(bundle.plan.content?.blocks)
        ? await writePlanLocalFiles({
            planId: bundle.plan.id,
            title: bundle.plan.title,
            brief: bundle.plan.brief,
            content: bundle.plan.content,
            url: planPath(bundle.plan.id, bundle.plan.kind),
          })
        : null;
    return {
      ...bundle,
      planId: id,
      html: buildPlanHtml(bundle),
      path: planPath(id, kind),
      url: planPath(id, kind),
      ...(local?.written ? { localFiles: local } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string; kind?: string } } | null)
      ?.plan;
    if (!plan?.id) return null;
    const isRecap = plan.kind === "recap";
    return {
      url: planDeepLink(plan.id, isRecap ? "recap" : "plan"),
      label: isRecap ? "Open Recap" : "Open Plan",
      view: "plan",
    };
  },
});
