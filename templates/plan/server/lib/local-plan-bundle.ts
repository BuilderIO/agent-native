import type { PlanContent } from "../../shared/plan-content.js";
import type { PlanBundle, PlanComment, PlanKind } from "../../shared/types.js";
import { exportPlanContentToMdxFolder } from "../plan-mdx.js";
import { buildPlanHtml, nowIso } from "../plans.js";
import { getLocalPlanOwnerEmail } from "./local-identity.js";
import type { LocalPlanReadResult } from "./local-plan-files.js";

// Count blocks by type (descending into tabs/columns) for the bundle summary.
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

// Shared DB-free PlanBundle response for the local-folder actions; comments are
// passed in from comments.json rather than hardcoded to [].
export async function buildLocalPlanBundleResult(opts: {
  local: LocalPlanReadResult;
  kind: PlanKind;
  role: "viewer" | "editor";
  comments: PlanComment[];
  currentFocus: string;
  title?: string;
  brief?: string;
}) {
  const { local, kind, role, comments, currentFocus } = opts;
  const now = nowIso();
  const title = opts.title ?? local.content.title ?? local.slug;
  const brief = opts.brief ?? local.content.brief ?? "Local files preview.";
  const id = `local-${local.slug}`;
  const visibleComments = comments.filter((comment) => !comment.deletedAt);
  const bundle: PlanBundle = {
    plan: {
      id,
      title,
      brief,
      kind,
      status: "review",
      source: "imported",
      repoPath: local.folder,
      currentFocus,
      html: null,
      markdown: local.mdx["plan.mdx"],
      content: local.content,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
    },
    access: {
      role,
      ownerEmail: getLocalPlanOwnerEmail(),
      orgId: null,
      visibility: "private",
    },
    sections: [],
    comments: visibleComments,
    events: [],
    summary: {
      sectionCounts: countLocalPlanBlocks(local.content.blocks),
      commentCount: visibleComments.length,
      openCommentCount: visibleComments.filter(
        (comment) => comment.status === "open",
      ).length,
    },
  };

  return {
    ...bundle,
    planId: id,
    localOnly: true as const,
    slug: local.slug,
    folder: local.folder,
    repoPath: local.repoPath,
    path: local.routePath,
    url: local.url,
    suggestedRepoPath: local.suggestedRepoPath,
    html: buildPlanHtml(bundle),
    mdx: await exportPlanContentToMdxFolder({
      content: bundle.plan.content,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      planId: id,
      url: local.routePath,
    }),
  };
}
