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

export default defineAction({
  description:
    "Patch the MDX source for an Agent-Native Plan by stable semantic IDs, then normalize it back into runtime JSON. Use ONLY when working with exported MDX source files (repo check-in workflows); for live plans prefer update-visual-plan with contentPatches. Suitable for tiny source-control friendly diffs: one markdown block, one artboard, one annotation, or one wireframe node.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    patches: planMdxSourcePatchesSchema.describe(
      "AST-backed MDX source patches. Prefer targeted ops over replace-file whenever possible so diffs stay small.",
    ),
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
