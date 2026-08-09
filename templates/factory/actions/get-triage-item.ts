import { defineAction } from "@agent-native/core/action";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  triageDecisions,
  triageFeedback,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";

export default defineAction({
  description:
    "Inspect one Factory item, including its append-only shadow decisions, feedback, and run reconciliation state.",
  schema: z.object({ itemId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ itemId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const item = (
      await db
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Triage item not found");

    const decisions = await db
      .select()
      .from(triageDecisions)
      .where(
        and(
          eq(triageDecisions.itemId, itemId),
          eq(triageDecisions.orgId, orgId),
        ),
      )
      .orderBy(asc(triageDecisions.createdAt));
    const feedback = await db
      .select()
      .from(triageFeedback)
      .where(eq(triageFeedback.orgId, orgId))
      .orderBy(asc(triageFeedback.createdAt));
    const runs = await db
      .select()
      .from(triageRuns)
      .where(and(eq(triageRuns.itemId, itemId), eq(triageRuns.orgId, orgId)))
      .orderBy(asc(triageRuns.startedAt));

    const matchingFeedback = feedback.filter((entry) =>
      decisions.some((decision) => decision.id === entry.decisionId),
    );
    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "get-triage-item",
        kind: "read",
        itemId,
        source: item.source,
        sourceUrl: item.sourceUrl,
        summary: `Inspected ${item.title}`,
        details: {
          decisionCount: decisions.length,
          feedbackCount: matchingFeedback.length,
          runCount: runs.length,
          coverage: item.coverage,
        },
      },
    );

    return {
      ...item,
      decisions: decisions.map((decision) => ({
        decisionId: decision.id,
        outcome: decision.outcome,
        summary: decision.reason,
        reason: decision.reason,
        mode: decision.mode,
        createdAt: decision.createdAt,
      })),
      feedback: matchingFeedback,
      runs,
    };
  },
});
