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
import { accessFilter } from "@agent-native/core/sharing";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { loadPlanBundle, summarizePlans } from "../server/plans.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Agent-Native Plans, including the active HTML plan, sections, and annotations.",
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
            "For fast visual-plan iteration, call get-visual-plan with this plan ID to read the current HTML, then call update-visual-plan with a revised html string. The UI refreshes the iframe automatically.",
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
          .where(accessFilter(schema.plans, schema.planShares))
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
