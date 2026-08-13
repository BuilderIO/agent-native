import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems, triageDecisions } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import {
  triageItemStatusSchema,
  triageSourceSchema,
} from "../server/triage/contracts.js";

export default defineAction({
  description:
    "List the Factory observation queue. Results are scoped to the active workspace and include the latest shadow decision summary. Scheduled reviewers must pass needsReview true with a bounded source and limit so unchanged items are not re-reviewed.",
  schema: z.object({
    status: triageItemStatusSchema.optional(),
    source: triageSourceSchema.optional(),
    needsReview: z.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ status, source, needsReview, limit }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const reviewStatuses = source === "github" ? ["pr_observed"] : ["received"];
    const items = await db
      .select()
      .from(triageItems)
      .where(
        and(
          eq(triageItems.orgId, orgId),
          needsReview
            ? inArray(triageItems.status, reviewStatuses)
            : status
              ? eq(triageItems.status, status)
              : undefined,
          source ? eq(triageItems.source, source) : undefined,
        ),
      )
      .orderBy(desc(triageItems.updatedAt))
      .limit(limit);

    const decisions = await db
      .select()
      .from(triageDecisions)
      .where(eq(triageDecisions.orgId, orgId))
      .orderBy(desc(triageDecisions.createdAt))
      .limit(500);
    const latestByItem = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) {
      if (!latestByItem.has(decision.itemId)) {
        latestByItem.set(decision.itemId, decision);
      }
    }

    const listedItems = items.map((item) => {
      const latestDecision = latestByItem.get(item.id);
      return {
        id: item.id,
        itemId: item.id,
        source: item.source,
        sourceName: item.source,
        externalId: item.externalId,
        sourceUrl: item.sourceUrl,
        title: item.title,
        summary: item.summary,
        status: item.status,
        risk: item.risk,
        coverage: item.coverage,
        repository: item.repository,
        pullRequestNumber: item.pullRequestNumber,
        headSha: item.headSha,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        reason: latestDecision?.reason ?? null,
        decisionSummary: latestDecision?.reason ?? null,
        latestDecision: latestDecision
          ? {
              id: latestDecision.id,
              outcome: latestDecision.outcome,
              reason: latestDecision.reason,
              mode: latestDecision.mode,
              createdAt: latestDecision.createdAt,
            }
          : null,
      };
    });

    for (const item of listedItems) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "list-triage-items",
          kind: "read",
          itemId: item.itemId,
          source: item.source,
          sourceUrl: item.sourceUrl,
          summary: item.title,
          details: {
            status: item.status,
            coverage: item.coverage,
            decision: item.latestDecision?.outcome ?? null,
          },
        },
      );
    }
    return listedItems;
  },
});
