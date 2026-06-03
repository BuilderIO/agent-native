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
import { loadContractBundle, summarizeContracts } from "./_contracts.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Visual Plans, including active plan, review queue, feedback, annotations, and proof summary.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    const nav = navigation as { contractId?: string; view?: string } | null;

    if (nav?.contractId) {
      try {
        const bundle = await loadContractBundle(nav.contractId);
        screen.visualPlan = {
          plan: bundle.contract,
          summary: bundle.summary,
          reviewQueue: bundle.reviewQueue,
          unconsumedFeedback: bundle.feedback.filter(
            (item) => !item.consumedAt,
          ),
          acceptanceCriteria: bundle.items
            .filter((item) => item.type === "acceptance_criterion")
            .map((item) => ({
              id: item.id,
              title: item.title,
              reviewState: item.reviewState,
              evidenceCount: bundle.evidence.filter((evidence) =>
                evidence.linkedItemIds.includes(item.id),
              ).length,
              verification:
                bundle.verifications
                  .filter(
                    (verification) => verification.criterionItemId === item.id,
                  )
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                  .pop()?.status ?? "missing",
            })),
        };
      } catch {
        screen.visualPlanError = `Could not load visual plan ${nav.contractId}`;
      }
    }

    if (!nav?.contractId || nav.view === "plans" || nav.view === "contracts") {
      try {
        const rows = await getDb()
          .select()
          .from(schema.contracts)
          .where(accessFilter(schema.contracts, schema.contractShares))
          .orderBy(desc(schema.contracts.updatedAt))
          .limit(12);
        screen.visualPlansList = await summarizeContracts(rows);
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
