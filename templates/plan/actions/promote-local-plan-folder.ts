import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getLocalPlanOwnerEmail,
  isLocalPlanRuntime,
} from "../server/lib/local-identity.js";
import { promotePlanLocalFolder } from "../server/lib/local-plan-files.js";
import {
  localPlanKindSchema,
  resolveLocalPlanKind,
} from "../server/lib/local-plan-kind.js";
import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import { buildPlanHtml, nowIso } from "../server/plans.js";
import type { PlanContent } from "../shared/plan-content.js";
import type { PlanBundle, PlanKind } from "../shared/types.js";

export default defineAction({
  description:
    "Copy a DB-free local Agent-Native Plan MDX folder into a repo-relative folder, using apps.plan.roots[0].path from agent-native.json when no targetPath is provided and falling back to plans/<slug>.",
  schema: z.object({
    slug: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/)
      .describe("Current local plan folder slug, for example checkout-review."),
    path: z
      .string()
      .optional()
      .describe(
        "Optional current repo-relative folder path if this plan is already opened from a repo path.",
      ),
    targetPath: z
      .string()
      .optional()
      .describe(
        "Repo-relative destination folder, for example plans/checkout-review. Defaults to apps.plan.roots[0].path/<slug> or plans/<slug>.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace an existing destination folder."),
    kind: localPlanKindSchema.optional(),
  }),
  requiresAuth: false,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    isConsequential: true,
    title: "Promote Local Plan Folder",
    description:
      "Copy a temporary local MDX plan folder into the current repo so future edits save there.",
  },
  run: async (args) => {
    if (!isLocalPlanRuntime()) {
      throw new Error(
        "Local plan folder promotion is only available in local Plan runtime.",
      );
    }

    const result = await promotePlanLocalFolder({
      slug: args.slug,
      path: args.path,
      targetPath: args.targetPath,
      overwrite: args.overwrite,
    });
    const promoted = result.promoted;
    const kind = resolveLocalPlanKind(args.kind, promoted.mdx) as PlanKind;
    const now = nowIso();
    const title = promoted.content.title || promoted.slug;
    const brief = promoted.content.brief || "Local files preview.";
    const planId = `local-${promoted.slug}`;
    const bundle: PlanBundle = {
      plan: {
        id: planId,
        title,
        brief,
        kind,
        status: "review",
        source: "imported",
        repoPath: promoted.folder,
        currentFocus: "local-files editing",
        html: null,
        markdown: promoted.mdx["plan.mdx"],
        content: promoted.content,
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
      },
      access: {
        role: "editor",
        ownerEmail: getLocalPlanOwnerEmail(),
        orgId: null,
        visibility: "private",
      },
      sections: [],
      comments: [],
      events: [],
      summary: {
        sectionCounts: countLocalPlanBlocks(promoted.content.blocks),
        commentCount: 0,
        openCommentCount: 0,
      },
    };

    return {
      ...bundle,
      planId,
      localOnly: true,
      slug: promoted.slug,
      folder: promoted.folder,
      repoPath: promoted.repoPath,
      path: promoted.routePath,
      url: promoted.url,
      suggestedRepoPath: promoted.suggestedRepoPath,
      targetPath: result.targetPath,
      alreadyPromoted: result.alreadyPromoted,
      html: buildPlanHtml(bundle),
      mdx: await exportPlanContentToMdxFolder({
        content: bundle.plan.content,
        title: bundle.plan.title,
        brief: bundle.plan.brief,
        planId,
        url: promoted.routePath,
      }),
      localFiles: result.localFiles,
    };
  },
  link: ({ args }) => ({
    url: args.targetPath
      ? `/local-plans/${encodeURIComponent(args.slug)}?${new URLSearchParams({
          path: args.targetPath,
        }).toString()}`
      : `/local-plans/${encodeURIComponent(args.slug)}`,
    label: "Open Promoted Local Plan",
    view: "plan",
  }),
});

function countLocalPlanBlocks(blocks: PlanContent["blocks"]) {
  const counts: Record<string, number> = {};
  const visitBlocks = (items: PlanContent["blocks"]) => {
    for (const block of items) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
      if (block.type === "tabs") {
        for (const tab of block.data.tabs) visitBlocks(tab.blocks);
      } else if (block.type === "columns") {
        for (const column of block.data.columns) visitBlocks(column.blocks);
      }
    }
  };
  visitBlocks(blocks);
  return counts;
}
