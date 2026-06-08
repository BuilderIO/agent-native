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
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { resolvePlanAccessContext } from "../server/lib/local-identity.js";
import { loadPlanBundle, summarizePlans } from "../server/plans.js";

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
    const nav = navigation as { planId?: string; view?: string } | null;

    if (nav?.planId) {
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
            "For fast visual/prototype plan iteration, call get-visual-plan with this plan ID to read structured content, exported HTML, comments, and sections. Prefer update-visual-plan contentPatches for targeted edits by blockId, prototype screenId, or canvas id; use full content only for broad restructuring, and html only for legacy imported artifacts. For rollback, list-plan-versions and get-plan-version inspect saved snapshots; restore-plan-version only when the user asks to restore.",
        };
      } catch {
        screen.visualPlanError = `Could not load visual plan ${nav.planId}`;
      }
    }

    if (!nav?.planId || nav.view === "plans") {
      try {
        const rows = await getDb()
          .select()
          .from(schema.plans)
          .where(
            accessFilter(
              schema.plans,
              schema.planShares,
              resolvePlanAccessContext(currentAccess()),
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
