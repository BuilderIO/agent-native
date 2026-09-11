import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  orgFactoryItemFilter,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordManualFactoryAudit } from "../server/triage/audit.js";
import { mergeTriageMetadata } from "../server/triage/metadata.js";

const OUTCOME_SUMMARY = {
  resolved: "Marked resolved",
  reopen: "Sent back to automation",
} as const;

export default defineAction({
  description:
    "Manually resolve a Factory inbox item or send it back to automation for re-review. This is independent of the automation pipeline: 'resolved' is a filterable terminal status no automation scan ever selects, and 'reopen' sets the item back to the status the next scheduled automation run scans for (received for Slack/Sentry, pr_observed for GitHub) and clears the metadata flag (a claimed Slack reaction, or a parked GitHub babysit state) that would otherwise keep it out of that scan.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    itemId: z.string().min(1),
    outcome: z.enum(["resolved", "reopen"]),
  }),
  http: { method: "POST" },
  audit: {
    target: (args: { itemId: string }) => ({
      type: "factory-item",
      id: args.itemId,
    }),
    summary: (args: { itemId: string; outcome: "resolved" | "reopen" }) =>
      `${OUTCOME_SUMMARY[args.outcome]} for Factory item ${args.itemId}`,
  },
  run: async ({ factoryId, itemId, outcome }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();

    return await db.transaction(async (tx) => {
      const item = (
        await tx
          .select()
          .from(triageItems)
          .where(
            and(
              eq(triageItems.id, itemId),
              orgFactoryItemFilter(orgId, factoryId),
            ),
          )
          .limit(1)
      )[0];
      if (!item) throw new Error("Triage item not found");

      const nextStatus =
        outcome === "resolved"
          ? "resolved"
          : item.source === "github"
            ? "pr_observed"
            : "received";

      // Reopening a claimed Slack item or a parked GitHub PR only helps if the
      // metadata gate that took it out of the automation scan is cleared too;
      // status alone leaves it invisible to the next run.
      const metadataPatch: Record<string, undefined> = {};
      if (outcome === "reopen") {
        if (item.source === "slack")
          metadataPatch.slackReactionName = undefined;
        if (item.source === "github") metadataPatch.prBabysitState = undefined;
      }
      const metadataJson =
        Object.keys(metadataPatch).length > 0
          ? mergeTriageMetadata(item.metadataJson, metadataPatch)
          : item.metadataJson;

      const now = new Date().toISOString();
      // Guard against a poller or another manual edit landing between the
      // read above and this write: only apply if the row is still the
      // snapshot we read.
      const updated = await tx
        .update(triageItems)
        .set({ status: nextStatus, metadataJson, updatedAt: now })
        .where(
          and(
            eq(triageItems.id, itemId),
            orgFactoryItemFilter(orgId, factoryId),
            eq(triageItems.updatedAt, item.updatedAt),
          ),
        )
        .returning({ id: triageItems.id });
      if (updated.length === 0) {
        throw new Error(
          "This item changed since it was loaded. Refresh and try again.",
        );
      }

      await recordManualFactoryAudit(
        { userEmail, orgId },
        {
          action: "set-triage-item-outcome",
          kind: "governance",
          factoryId,
          itemId,
          source: item.source,
          sourceUrl: item.sourceUrl,
          summary: `${OUTCOME_SUMMARY[outcome]} by ${userEmail}.`,
          details: { outcome, previousStatus: item.status, nextStatus },
        },
        undefined,
        tx,
      );

      return { ok: true, itemId, status: nextStatus };
    });
  },
});
