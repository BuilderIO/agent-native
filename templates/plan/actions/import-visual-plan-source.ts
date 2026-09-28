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

export default defineAction({
  description:
    "Create or replace a plan from source-control friendly MDX files (repo check-in workflows). Use ONLY when working with exported MDX source files; for live plans prefer update-visual-plan with contentPatches. The MDX folder is the authoring/export surface; the runtime model remains normalized structured JSON. When replacing an existing plan, pass expectedUpdatedAt to guard against concurrent edits.",
  schema: z.object({
    planId: z
      .string()
      .optional()
      .describe("Existing plan ID to replace. Omit to create a new plan."),
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
    let content: Awaited<ReturnType<typeof parsePlanMdxFolder>>;
    try {
      content = await parsePlanMdxFolder(args.mdx, {
        salvageInvalidBlocks: args.kind === "recap",
      });
      if (args.kind === "recap") {
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
      await assertPlanEditor(args.planId);

      const incomingAssets = args.mdx["assets/"];
      if (incomingAssets && Object.keys(incomingAssets).length > 0) {
        const srcByFilename = await importPlanAssets(
          args.planId,
          incomingAssets,
        );
        content = applyImportedAssets(content, srcByFilename);
      }

      if (args.expectedUpdatedAt) {
        const updatedRows = await db
          .update(schema.plans)
          .set({ updatedAt: args.expectedUpdatedAt })
          .where(
            and(
              eq(schema.plans.id, args.planId),
              eq(schema.plans.updatedAt, args.expectedUpdatedAt),
            ),
          )
          .returning({ id: schema.plans.id });
        if (updatedRows.length === 0) {
          throw new Error(
            "Plan changed while the source import was being prepared. Reload the plan and retry.",
          );
        }
      }

      await createPlanVersionSnapshot(args.planId, {
        force: true,
        label: "Before source import",
        createdBy: "agent",
      });
      await db
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
        .where(eq(schema.plans.id, args.planId));

      await writeEvent({
        planId: args.planId,
        type: "plan.source.imported",
        message: "Visual plan MDX source imported.",
        createdBy: "agent",
      });

      const bundle = await loadPlanBundle(args.planId);
      const local = isLocalPlanRuntime()
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

    const incomingAssetsCreate = args.mdx["assets/"];
    if (incomingAssetsCreate && Object.keys(incomingAssetsCreate).length > 0) {
      const srcByFilename = await importPlanAssets(id, incomingAssetsCreate);
      content = applyImportedAssets(content, srcByFilename);
      await db
        .update(schema.plans)
        .set({ content: serializePlanContent(content) })
        .where(eq(schema.plans.id, id));
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
    const local = isLocalPlanRuntime()
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
