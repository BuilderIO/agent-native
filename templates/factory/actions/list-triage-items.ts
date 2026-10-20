import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems, triageDecisions } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { authorMatchesFilter } from "../server/lib/factory-automation-config.js";
import { DEFAULT_FACTORY_ID } from "../server/lib/factory-ids.js";
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
  isWorkflowJobContent,
  requireFactoryAutomation,
} from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { isTerminalBabysitMetadata } from "../server/triage/babysit-pr-terminal.js";
import {
  triageConfidenceSchema,
  triageItemStatusSchema,
  triageRiskSchema,
  triageSourceSchema,
} from "../server/triage/contracts.js";
import { deriveInboxPresentation } from "../server/triage/inbox-presentation.js";
import {
  triageItemAuthor,
  triageItemAuthorId,
} from "../server/triage/metadata.js";
import { readStoredUserLabels } from "../server/triage/slack-user-labels.js";

export default defineAction({
  description:
    "List the Factory observation queue. Returns { items, nextCursor, hasMore }. Each item includes author when the source stored one. Results are scoped to the active workspace and include the latest shadow decision summary. Optional status, source, risk, confidence, and updatedAfter (ISO timestamp) filters narrow the queue. Scheduled reviewers must pass needsReview true with a bounded source and limit so unchanged items are not re-reviewed; iterate the items array.",
  schema: z.object({
    factoryId: factoryIdSchema.default(DEFAULT_FACTORY_ID),
    status: triageItemStatusSchema.optional(),
    source: triageSourceSchema.optional(),
    risk: triageRiskSchema.optional(),
    confidence: triageConfidenceSchema.optional(),
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
      confidence,
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
    const calling = await readCallingFactoryAutomation(context, {
      userEmail,
      orgId,
    });
    if (calling && isWorkflowJobContent(calling.content)) {
      await requireFactoryAutomation(
        context,
        { userEmail, orgId },
        "workflow",
        factoryId,
      );
    }
    const workLimit =
      context?.caller === "automation"
        ? (calling?.config.workLimit ?? 3)
        : limit;
    const effectiveLimit =
      context?.caller === "automation" ? Math.min(limit, workLimit) : limit;
    const fetchLimit =
      context?.caller === "automation" &&
      calling &&
      (calling.config.source === "github" || calling.config.source === "slack")
        ? Math.min(100, Math.max(effectiveLimit * 10, effectiveLimit))
        : effectiveLimit;
    const parsedCursor = cursor ? decodeInboxCursor(cursor) : null;
    const updatedAfterBound = parseUpdatedAfter(updatedAfter);
    const db = getDb();
    const reviewStatuses = source === "github" ? ["pr_observed"] : ["received"];
    const filterReviewPage =
      (context?.caller === "automation" &&
        calling &&
        (calling.config.source === "github" ||
          calling.config.source === "slack")) ||
      (needsReview && (source === "github" || source === "slack"));
    const maxScanPages = filterReviewPage ? 10 : 1;
    const eligible: Array<(typeof triageItems)["$inferSelect"]> = [];
    let scanCursor = parsedCursor;
    let lastExamined: (typeof triageItems)["$inferSelect"] | undefined;
    let lastKept: (typeof triageItems)["$inferSelect"] | undefined;
    let moreRaw = false;
    let filledPage = false;
    for (let pageIndex = 0; pageIndex < maxScanPages; pageIndex += 1) {
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
            confidence ? eq(triageItems.confidence, confidence) : undefined,
            updatedAfterBound
              ? gte(triageItems.updatedAt, updatedAfterBound)
              : undefined,
            scanCursor
              ? or(
                  lt(triageItems.updatedAt, scanCursor.updatedAt),
                  and(
                    eq(triageItems.updatedAt, scanCursor.updatedAt),
                    lt(triageItems.id, scanCursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(triageItems.updatedAt), desc(triageItems.id))
        .limit(fetchLimit + 1);
      moreRaw = rows.length > fetchLimit;
      const batch = rows.slice(0, fetchLimit);
      if (batch.length === 0) break;
      for (const item of batch) {
        lastExamined = item;
        if (
          context?.caller === "automation" &&
          calling &&
          calling.config.source === "github" &&
          !authorMatchesFilter(
            triageItemAuthorId(item.metadataJson),
            calling.config.authorMode,
            calling.config.authorIds,
          )
        ) {
          continue;
        }
        if (
          needsReview &&
          isTerminalBabysitMetadata(item.metadataJson, item.status)
        ) {
          continue;
        }
        if (
          needsReview &&
          deriveInboxPresentation({
            source: item.source,
            status: item.status,
            metadataJson: item.metadataJson,
          }).leavesReviewWindow
        ) {
          continue;
        }
        eligible.push(item);
        lastKept = item;
        if (eligible.length === effectiveLimit) {
          filledPage = true;
          break;
        }
      }
      if (filledPage) {
        if (lastKept) {
          moreRaw = moreRaw || batch.indexOf(lastKept) < batch.length - 1;
        }
        break;
      }
      if (!moreRaw) break;
      if (lastExamined) {
        scanCursor = { updatedAt: lastExamined.updatedAt, id: lastExamined.id };
      }
    }
    const page = eligible;
    const hasMore = moreRaw;
    const cursorRow = filledPage && lastKept ? lastKept : lastExamined;

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
      const inboxPresentation = deriveInboxPresentation({
        source: item.source,
        status: item.status,
        metadataJson: item.metadataJson,
      });
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
        confidence: item.confidence,
        coverage: item.coverage,
        repository: item.repository,
        pullRequestNumber: item.pullRequestNumber,
        headSha: item.headSha,
        author: triageItemAuthor(item.metadataJson) || null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        userLabels: readStoredUserLabels(item.metadataJson),
        inboxPresentation,
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
          limit: effectiveLimit,
          count: listedItems.length,
          needsReview,
          status: status ?? null,
          source: source ?? null,
          risk: risk ?? null,
          confidence: confidence ?? null,
          updatedAfter: updatedAfterBound ?? null,
          itemIds: listedItems.map((item) => item.itemId),
          listedItems: listedItems.map((item) => ({
            itemId: item.itemId,
            status: item.status,
            outcome: item.latestDecision?.outcome ?? null,
          })),
        },
      },
      factoryId,
    );
    return {
      items: listedItems,
      hasMore,
      nextCursor:
        hasMore && cursorRow
          ? encodeInboxCursor({
              updatedAt: cursorRow.updatedAt,
              id: cursorRow.id,
            })
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
