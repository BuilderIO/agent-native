import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { agentTouchDocument } from "@agent-native/core/collab";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isLocalPlanRuntime } from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import { createPlanVersionSnapshot } from "../server/lib/plan-versions.js";
import { serializePlanContent } from "../server/plan-content.js";
import {
  applyPlanMdxSourcePatches,
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
  planMdxSourcePatchesSchema,
  referencedBlockIdsForPlanComments,
} from "../server/plan-mdx.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  loadPlanBundle,
  nowIso,
  planDeepLink,
  planPath,
  writeEvent,
} from "../server/plans.js";
import type { PlanContent } from "../shared/plan-content.js";

const agentPlanMdxSourcePatchesSchema = z
  .array(
    z.discriminatedUnion("op", [
      z.object({
        op: z.literal("replace-markdown-block"),
        blockId: z.string().min(1),
        markdown: z.string().max(16_000),
        title: z.string().optional(),
      }),
      z.object({
        op: z.literal("update-component-prop"),
        file: z.enum(["plan.mdx", "canvas.mdx", "prototype.mdx"]),
        componentId: z.string().min(1),
        prop: z.string().min(1),
        value: z.unknown(),
      }),
      z.object({
        op: z.literal("update-wireframe-node"),
        nodeId: z.string().min(1),
        patch: z.record(z.string(), z.unknown()),
      }),
      z.object({
        op: z.literal("update-annotation"),
        annotationId: z.string().min(1),
        patch: z.object({
          type: z.enum(["note", "text", "callout", "arrow"]).optional(),
          title: z.string().optional(),
          text: z.string().max(2_000).optional(),
          points: z
            .array(z.object({ x: z.number(), y: z.number() }))
            .min(1)
            .max(12)
            .optional(),
          style: z
            .object({
              tone: z
                .enum(["default", "accent", "warn", "ok", "muted"])
                .optional(),
              stroke: z.enum(["solid", "dashed"]).optional(),
              width: z.number().min(1).max(12).optional(),
            })
            .optional(),
          targetId: z.string().optional(),
          placement: z
            .enum([
              "top",
              "right",
              "bottom",
              "left",
              "top-left",
              "top-right",
              "bottom-left",
              "bottom-right",
            ])
            .optional(),
          x: z.number().optional(),
          y: z.number().optional(),
        }),
      }),
    ]),
  )
  .max(80)
  .describe(
    "Small exported-MDX patches only. Never send replace-file or replace-artboard " +
      "from an agent; for a live plan use update-visual-plan contentPatches instead.",
  );

type PlanSurfaceCounts = {
  blocks: number;
  canvasFrames: number;
  prototypeScreens: number;
};

function planSurfaceCounts(content: PlanContent | null | undefined) {
  return {
    blocks: content?.blocks.length ?? 0,
    canvasFrames: content?.canvas?.frames.length ?? 0,
    prototypeScreens: content?.prototype?.screens.length ?? 0,
  } satisfies PlanSurfaceCounts;
}

function compactAgentWriteResult(
  bundle: Awaited<ReturnType<typeof loadPlanBundle>>,
  changed: Record<string, unknown>,
) {
  return {
    planId: bundle.plan.id,
    plan: {
      id: bundle.plan.id,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      kind: bundle.plan.kind,
      status: bundle.plan.status,
      currentFocus: bundle.plan.currentFocus,
      updatedAt: bundle.plan.updatedAt,
      surfaces: planSurfaceCounts(bundle.plan.content),
    },
    changed,
    path: planPath(bundle.plan.id, bundle.plan.kind),
    url: planPath(bundle.plan.id, bundle.plan.kind),
  };
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : stableJson(item)))
      .join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const pairs = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableContentHash(content: PlanContent | null | undefined) {
  return `sha256:${createHash("sha256")
    .update(stableJson(content ?? null))
    .digest("hex")}`;
}

function sanitizeAuditIdentifier(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._:-]+/g, "_")
      .slice(0, 120) || "unknown"
  );
}

function sourcePatchAuditTarget(
  patch: z.infer<typeof planMdxSourcePatchesSchema>[number],
) {
  switch (patch.op) {
    case "replace-file":
      return { op: patch.op, file: patch.file };
    case "replace-markdown-block":
      return {
        op: patch.op,
        target: sanitizeAuditIdentifier(patch.blockId),
      };
    case "update-component-prop":
      return {
        op: patch.op,
        file: patch.file,
        target: sanitizeAuditIdentifier(patch.componentId),
        prop: sanitizeAuditIdentifier(patch.prop),
      };
    case "update-wireframe-node":
      return {
        op: patch.op,
        target: sanitizeAuditIdentifier(patch.nodeId),
      };
    case "update-annotation":
      return {
        op: patch.op,
        target: sanitizeAuditIdentifier(patch.annotationId),
      };
    case "replace-artboard":
      return {
        op: patch.op,
        target: sanitizeAuditIdentifier(patch.artboardId),
      };
  }
}

function assertNoUnexpectedSurfaceCollapse(
  before: PlanSurfaceCounts,
  after: PlanSurfaceCounts,
  allowDestructive: boolean,
) {
  if (allowDestructive) return;

  const candidates: Array<[label: string, before: number, after: number]> = [
    ["blocks", before.blocks, after.blocks],
    ["canvas frames", before.canvasFrames, after.canvasFrames],
    ["prototype screens", before.prototypeScreens, after.prototypeScreens],
  ];
  const collapsed = candidates
    .filter(
      ([, beforeCount, afterCount]) => beforeCount > 0 && afterCount === 0,
    )
    .map(([label, beforeCount]) => `${label} (${beforeCount} to 0)`);

  if (collapsed.length === 0) return;
  throw new Error(
    `Source patch blocked because it would unexpectedly remove all ${collapsed.join(
      ", ",
    )}. Reload the plan and use granular patches, or retry with allowDestructive: true if clearing those surfaces is intentional.`,
  );
}

export default defineAction({
  description:
    "Patch the MDX source for an Agent-Native Plan by stable semantic IDs, then normalize it back into runtime JSON. Use ONLY when working with exported MDX source files (repo check-in workflows); for live plans prefer update-visual-plan with contentPatches. For agent calls, use only small semantic patches and never resend replace-file or replace-artboard payloads.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Revision from the latest plan read. Required for replace-file and checked before source patching so stale full-file replacements cannot overwrite newer work.",
      ),
    allowDestructive: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Allow an intentional nonempty-to-empty collapse of plan blocks, canvas frames, or prototype screens. Defaults to false.",
      ),
    patches: planMdxSourcePatchesSchema.describe(
      "AST-backed MDX source patches. Prefer targeted ops over replace-file whenever possible so diffs stay small.",
    ),
    note: z.string().optional().describe("Short audit note for plan history."),
  }),
  agentInputSchema: z.object({
    planId: z.string().describe("Plan ID"),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .optional()
      .describe("Revision from the latest plan read when required."),
    allowDestructive: z
      .boolean()
      .optional()
      .default(false)
      .describe("Allow an intentional nonempty-to-empty collapse."),
    patches: agentPlanMdxSourcePatchesSchema,
    note: z.string().optional().describe("Short audit note for plan history."),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Patch Visual Plan Source",
    description:
      "Apply granular MDX source patches and persist the normalized visual plan.",
  },
  run: async (args, ctx) => {
    // Only agent invocations (in-app tool loop / A2A → "tool"; external MCP →
    // "mcp") light the AI presence flag.
    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";
    await assertPlanEditor(args.planId);
    const bundle = await loadPlanBundle(args.planId);
    const versionAtLoad = bundle.plan.updatedAt;
    const hasReplaceFile = args.patches.some(
      (patch) => patch.op === "replace-file",
    );
    if (hasReplaceFile && !args.expectedUpdatedAt) {
      throw new Error(
        "replace-file requires expectedUpdatedAt from the latest plan read. Reload the plan and retry with its current updatedAt value.",
      );
    }
    if (
      args.expectedUpdatedAt &&
      args.expectedUpdatedAt !== bundle.plan.updatedAt
    ) {
      throw new Error(
        "Plan changed since the source was read. Reload the plan and retry against its current updatedAt value.",
      );
    }
    const referencedBlockIds = referencedBlockIdsForPlanComments(
      bundle.comments,
    );
    for (const patch of args.patches) {
      if (patch.op === "update-component-prop") {
        referencedBlockIds.add(patch.componentId);
      }
    }
    const currentMdx = await exportPlanContentToMdxFolder({
      content: bundle.plan.content,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      planId: bundle.plan.id,
      url: planPath(bundle.plan.id, bundle.plan.kind),
      referencedBlockIds,
    });
    const nextMdx = await applyPlanMdxSourcePatches(currentMdx, args.patches);
    const nextContent = await parsePlanMdxFolder(nextMdx);
    const beforeCounts = planSurfaceCounts(bundle.plan.content);
    const afterCounts = planSurfaceCounts(nextContent);
    assertNoUnexpectedSurfaceCollapse(
      beforeCounts,
      afterCounts,
      args.allowDestructive ?? false,
    );
    const beforeContentHash = stableContentHash(bundle.plan.content);
    const afterContentHash = stableContentHash(nextContent);
    const now = nowIso();
    await createPlanVersionSnapshot(args.planId, {
      force: true,
      label: args.note ?? "Before source patch",
      createdBy: "agent",
    });

    const updatedRows = await getDb()
      .update(schema.plans)
      .set({
        title: nextContent.title ?? bundle.plan.title,
        brief: nextContent.brief ?? bundle.plan.brief,
        markdown: nextMdx["plan.mdx"],
        content: serializePlanContent(nextContent),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.plans.id, args.planId),
          eq(schema.plans.updatedAt, versionAtLoad),
        ),
      )
      .returning({ id: schema.plans.id });

    if (updatedRows.length === 0) {
      throw new Error(
        "Plan changed while source patches were being applied. Reload the plan and retry your patch.",
      );
    }

    await writeEvent({
      planId: args.planId,
      type: "plan.source.patched",
      message:
        args.note ??
        `Applied ${args.patches.length} visual plan source patch(es).`,
      payload: {
        patchOps: args.patches.map((patch) => patch.op),
        targets: args.patches.map(sourcePatchAuditTarget),
        counts: {
          before: beforeCounts,
          after: afterCounts,
        },
        contentHashes: {
          before: beforeContentHash,
          after: afterContentHash,
        },
      },
      createdBy: "agent",
    });

    // Surface AI presence + a lingering highlight on the patched block(s) via the
    // plan-presence doc. Best-effort — never fail the save on presence.
    if (isAgentCaller) {
      try {
        const patchIds = new Set<string>();
        for (const patch of args.patches) {
          if (patch.op === "replace-markdown-block")
            patchIds.add(patch.blockId);
          else if (patch.op === "update-component-prop") {
            patchIds.add(patch.componentId);
          } else if (patch.op === "update-wireframe-node") {
            patchIds.add(patch.nodeId);
          }
        }
        if (patchIds.size === 0) {
          for (const block of nextContent.blocks) patchIds.add(block.id);
        }
        const blockIds = Array.from(patchIds).slice(0, 12);
        agentTouchDocument(`plan:${args.planId}`, {
          edit: {
            descriptor: { kind: "paths", paths: blockIds },
            label: `Patched ${args.patches.length} source block${
              args.patches.length === 1 ? "" : "s"
            }`,
          },
          metadata: { blockIds },
        });
      } catch (error) {
        console.error(
          "[patch-visual-plan-source] agent presence publish failed",
          error,
        );
      }
    }

    const updated = await loadPlanBundle(args.planId);
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: updated.plan.id,
          title: updated.plan.title,
          brief: updated.plan.brief,
          content: updated.plan.content,
          url: planPath(updated.plan.id, updated.plan.kind),
          referencedBlockIds: referencedBlockIdsForPlanComments(
            updated.comments,
          ),
        })
      : null;
    if (isAgentCaller) {
      return {
        ...compactAgentWriteResult(updated, {
          patchOps: args.patches.map((patch) => patch.op),
          counts: {
            before: beforeCounts,
            after: afterCounts,
          },
        }),
        ...(local?.written ? { localFiles: local } : {}),
      };
    }
    return {
      ...updated,
      planId: updated.plan.id,
      html: buildPlanHtml(updated),
      mdx: nextMdx,
      path: planPath(updated.plan.id, updated.plan.kind),
      url: planPath(updated.plan.id, updated.plan.kind),
      ...(local?.written ? { localFiles: local } : {}),
    };
  },
  link: ({ args }) => ({
    url: planDeepLink(args.planId),
    label: "Open Plan",
    view: "plan",
  }),
});
