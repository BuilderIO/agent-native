import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems, triageDecisions } from "../server/db/schema.js";
import { DEFAULT_FACTORY_ID } from "../server/factory-graph/store.js";
import {
  factoryIdSchema,
  orgFactoryDecisionFilter,
  orgFactoryItemFilter,
} from "../server/lib/factory-scope.js";
import {
  decodeInboxCursor,
  encodeInboxCursor,
} from "../server/lib/inbox-cursor.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import {
  triageItemStatusSchema,
  triageRiskSchema,
  triageSourceSchema,
} from "../server/triage/contracts.js";
import { readStoredUserLabels } from "../server/triage/slack-user-labels.js";

export default defineAction({
  description:
    "List the Factory observation queue. Returns { items, nextCursor, hasMore }. Results are scoped to the active workspace and include the latest shadow decision summary. Optional status, source, risk, and updatedAfter (ISO timestamp) filters narrow the queue. Scheduled reviewers must pass needsReview true with a bounded source and limit so unchanged items are not re-reviewed; iterate the items array.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    status: triageItemStatusSchema.optional(),
    source: triageSourceSchema.optional(),
    risk: triageRiskSchema.optional(),
    updatedAfter: z.string().trim().min(1).max(40).optional(),
    needsReview: z.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(400).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    {
      factoryId,
      status,
      source,
      risk,
      updatedAfter,
      needsReview,
      limit,
      cursor,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const parsedCursor = cursor ? decodeInboxCursor(cursor) : null;
    const updatedAfterBound = parseUpdatedAfter(updatedAfter);
    const db = getDb();
    const reviewStatuses =
      source === "github"
        ? ["pr_observed"]
        : source === "slack"
          ? ["received", "automation_started", "evidence_ready"]
          : ["received"];
    const rows = await db
      .select()
      .from(triageItems)
      .where(
        and(
          orgFactoryItemFilter(orgId, factoryId),
          needsReview
            ? inArray(triageItems.status, reviewStatuses)
            : status
              ? eq(triageItems.status, status)
              : undefined,
          source ? eq(triageItems.source, source) : undefined,
          risk ? eq(triageItems.risk, risk) : undefined,
          updatedAfterBound
            ? gte(triageItems.updatedAt, updatedAfterBound)
            : undefined,
          parsedCursor
            ? or(
                lt(triageItems.updatedAt, parsedCursor.updatedAt),
                and(
                  eq(triageItems.updatedAt, parsedCursor.updatedAt),
                  lt(triageItems.id, parsedCursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(triageItems.updatedAt), desc(triageItems.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page[page.length - 1];

    const pageIds = page.map((item) => item.id);
    const decisions =
      pageIds.length === 0
        ? []
        : await db
            .select()
            .from(triageDecisions)
            .where(
              and(
                orgFactoryDecisionFilter(orgId, factoryId),
                inArray(triageDecisions.itemId, pageIds),
              ),
            )
            .orderBy(desc(triageDecisions.createdAt));
    const latestByItem = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) {
      if (!latestByItem.has(decision.itemId)) {
        latestByItem.set(decision.itemId, decision);
      }
    }

    const listedItems = page.map((item) => {
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
        userLabels: readStoredUserLabels(item.metadataJson),
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

    const purpose = needsReview ? "review_candidates" : "repeat_scan";
    const noun = listedItems.length === 1 ? "item" : "items";
    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "list-triage-items",
        kind: "read",
        source: source ?? listedItems[0]?.source ?? null,
        summary: needsReview
          ? `Loaded ${listedItems.length} review candidate${listedItems.length === 1 ? "" : "s"}.`
          : `Loaded ${listedItems.length} recent ${source ?? "queue"} ${noun}.`,
        details: {
          purpose,
          limit,
          count: listedItems.length,
          needsReview,
          status: status ?? null,
          source: source ?? null,
          risk: risk ?? null,
          updatedAfter: updatedAfterBound ?? null,
          itemIds: listedItems.map((item) => item.itemId),
        },
      },
      factoryId,
    );
    return {
      items: listedItems,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeInboxCursor({ updatedAt: last.updatedAt, id: last.id })
          : null,
    };
  },
});

function parseUpdatedAfter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("updatedAfter is unreadable.");
  }
  return new Date(parsed).toISOString();
}
