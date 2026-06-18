/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { accessFilter, currentAccess } from "@agent-native/core/sharing";
import { and, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  isLocalPlanRuntime,
  resolvePlanAccessContext,
} from "../server/lib/local-identity.js";
import { readPlanLocalFolder } from "../server/lib/local-plan-files.js";
import { loadPlanBundle, summarizePlans } from "../server/plans.js";
import type { PlanContent } from "../shared/plan-content.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Agent-Native Plan, including the active structured plan, exported HTML, sections, and annotations.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    const nav = navigation as {
      planId?: string;
      localPlanSlug?: string;
      localPlanPath?: string;
      view?: string;
    } | null;

    if (nav?.view === "chat") {
      screen.productKnowledgeChat = {
        defaultScope: "merged pull request visual recaps",
        workflows: [
          "Use search-pr-recaps first for shipped-last-week, historical API changes, and UI-from-recap questions.",
          "Use visual-answer for live code questions that need the bridge, GitHub, or explicit code context, then publish the answer as a structured visual plan.",
          "Use get-plan-blocks or list-plan-components before generating diagrams, wireframes, API specs, or custom registered block components.",
        ],
      };
    }

    if (nav?.localPlanSlug && isLocalPlanRuntime()) {
      try {
        const local = await readPlanLocalFolder({
          slug: nav.localPlanSlug,
          path: nav.localPlanPath,
        });
        screen.visualPlan = {
          localOnly: true,
          slug: local.slug,
          folder: local.folder,
          repoPath: local.repoPath,
          plan: {
            id: `local-${local.slug}`,
            title: local.content.title ?? local.slug,
            brief: local.content.brief ?? "Local files preview.",
            repoPath: local.folder,
            currentFocus: "local-files editing",
            content: local.content,
            markdown: local.mdx["plan.mdx"],
          },
          summary: {
            sectionCounts: countLocalPlanBlocks(local.content.blocks),
            commentCount: 0,
            openCommentCount: 0,
          },
          contentBlockCount: local.content.blocks.length,
          hasCanvas: Boolean(local.content.canvas),
          hasPrototype: Boolean(local.content.prototype),
          files: Object.keys(local.mdx),
          agentWorkflow:
            "This is a DB-free local MDX folder. Read it with get-local-plan-folder and edit it with update-local-plan-folder contentPatches; pass localPlanPath/path when present so writes go back to this repo folder without touching SQL.",
        };
      } catch {
        screen.visualPlanError = `Could not load local plan ${nav.localPlanSlug}`;
      }
    } else if (nav?.planId) {
      try {
        const bundle = await loadPlanBundle(nav.planId);
        screen.visualPlan = {
          plan: bundle.plan,
          summary: bundle.summary,
          contentBlockCount: bundle.plan.content?.blocks.length ?? 0,
          prototype: bundle.plan.content?.prototype
            ? {
                title: bundle.plan.content.prototype.title,
                initialScreenId: bundle.plan.content.prototype.initialScreenId,
                screenCount: bundle.plan.content.prototype.screens.length,
                screens: bundle.plan.content.prototype.screens.map(
                  (screen) => ({
                    id: screen.id,
                    title: screen.title,
                    surface: screen.surface,
                    summary: screen.summary,
                  }),
                ),
                transitionCount:
                  bundle.plan.content.prototype.transitions?.length ?? 0,
              }
            : null,
          htmlLength: bundle.plan.html?.length ?? 0,
          sections: bundle.sections.map((section) => ({
            id: section.id,
            type: section.type,
            title: section.title,
            order: section.order,
          })),
          openComments: bundle.comments.filter(
            (comment) => comment.status === "open",
          ),
          agentWorkflow:
            "For fast visual plan prototype iteration, call get-visual-plan with this plan ID to read structured content, exported HTML, comments, and sections. Prefer update-visual-plan contentPatches for targeted edits by blockId, prototype screenId, or canvas id; use full content only for broad restructuring, and html only for legacy imported artifacts. For rollback, list-plan-versions and get-plan-version inspect saved snapshots; restore-plan-version only when the user asks to restore.",
        };
      } catch {
        screen.visualPlanError = `Could not load visual plan ${nav.planId}`;
      }
    }

    if (!nav?.planId || nav.view === "plans" || nav.view === "chat") {
      try {
        // Only the summary columns — never the large html/markdown/content
        // blobs — so the agent's screen context stays lean.
        const rows = await getDb()
          .select({
            id: schema.plans.id,
            title: schema.plans.title,
            brief: schema.plans.brief,
            kind: schema.plans.kind,
            status: schema.plans.status,
            source: schema.plans.source,
            repoPath: schema.plans.repoPath,
            currentFocus: schema.plans.currentFocus,
            hostedPlanId: schema.plans.hostedPlanId,
            hostedPlanUrl: schema.plans.hostedPlanUrl,
            sourceUrl: schema.plans.sourceUrl,
            createdAt: schema.plans.createdAt,
            updatedAt: schema.plans.updatedAt,
            approvedAt: schema.plans.approvedAt,
            deletedAt: schema.plans.deletedAt,
            deletedBy: schema.plans.deletedBy,
            ownerEmail: schema.plans.ownerEmail,
          })
          .from(schema.plans)
          .where(
            and(
              accessFilter(
                schema.plans,
                schema.planShares,
                resolvePlanAccessContext(currentAccess()),
              ),
              isNull(schema.plans.deletedAt),
            ),
          )
          .orderBy(desc(schema.plans.updatedAt))
          .limit(12);
        screen.visualPlansList = await summarizePlans(rows);
      } catch {
        // continue without list detail
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
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
