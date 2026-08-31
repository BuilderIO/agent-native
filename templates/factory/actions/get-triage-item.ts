import { defineAction } from "@agent-native/core/action";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  factoryAuditEvents,
  triageDecisions,
  triageFeedback,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  orgFactoryAuditEventFilter,
  orgFactoryDecisionFilter,
  orgFactoryFeedbackFilter,
  orgFactoryItemFilter,
  orgFactoryRunFilter,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { triageItemAuthor } from "../server/triage/metadata.js";
import { readStoredUserLabels } from "../server/triage/slack-user-labels.js";

const ITEM_ACTION_KINDS = [
  "decision",
  "external_action",
  "governance",
] as const;

export default defineAction({
  description:
    "Inspect one Factory item, including its append-only shadow decisions, feedback, item-scoped audit actions, and run reconciliation state.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    itemId: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId, itemId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const db = getDb();
    const item = (
      await db
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

    const decisions = await db
      .select()
      .from(triageDecisions)
      .where(
        and(
          eq(triageDecisions.itemId, itemId),
          orgFactoryDecisionFilter(orgId, factoryId),
        ),
      )
      .orderBy(asc(triageDecisions.createdAt));
    const feedback = await db
      .select()
      .from(triageFeedback)
      .where(orgFactoryFeedbackFilter(orgId, factoryId))
      .orderBy(asc(triageFeedback.createdAt));
    const runs = await db
      .select()
      .from(triageRuns)
      .where(
        and(
          eq(triageRuns.itemId, itemId),
          orgFactoryRunFilter(orgId, factoryId),
        ),
      )
      .orderBy(asc(triageRuns.startedAt));
    const events = await db
      .select()
      .from(factoryAuditEvents)
      .where(
        and(
          eq(factoryAuditEvents.itemId, itemId),
          orgFactoryAuditEventFilter(orgId, factoryId),
          inArray(factoryAuditEvents.kind, [...ITEM_ACTION_KINDS]),
        ),
      )
      .orderBy(asc(factoryAuditEvents.createdAt));

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
          eventCount: events.length,
          coverage: item.coverage,
          itemTitle: item.title,
          itemSummary: item.summary,
        },
      },
      factoryId,
    );

    return {
      ...item,
      itemId: item.id,
      author: triageItemAuthor(item.metadataJson) || null,
      userLabels: readStoredUserLabels(item.metadataJson),
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
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        kind: event.kind,
        status: event.status,
        summary: event.summary,
        details: parseDetails(event.detailsJson),
        createdAt: event.createdAt,
      })),
    };
  },
});

function parseDetails(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Factory audit details are unreadable.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Factory audit details are unreadable.");
  }
  return parsed as Record<string, unknown>;
}
