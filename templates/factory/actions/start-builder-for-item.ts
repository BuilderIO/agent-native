import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  triageConfig,
  triageDecisions,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { startBuilderRun } from "../server/triage/builder-executor.js";
import { stableId } from "../server/triage/ids.js";
import {
  metadataBoolean,
  parseTriageMetadata,
  serializeTriageMetadata,
} from "../server/triage/metadata.js";
import { detectOwnerOwnedArea } from "../server/triage/pr-policy.js";
import { createSlackReader } from "../server/triage/slack-client.js";

/** Slack notifies only with `<@USERID>`. Plaintext @handles do not ping anyone. */
const BUILDER_SLACK_USER_ID = "U096KN3EL2Y";
const replyTextPrefix = `<@${BUILDER_SLACK_USER_ID}> please run /address-feedback in the repo to address this feedback. Read the address-feedback, address-feedback-with-replies, review-latest-feedback, and review-prs skills as relevant, inspect the full thread and linked evidence, and fix the owning boundary. Please send a PR when ready, then have the @agent-native bot post a concise Fixed, In progress, or Clarification needed disposition in this same thread; an 👀 reaction or this handoff alone is not completion.`;
const plaintextBuilderReplyPrefix =
  "@builder.io please run /address-feedback in the repo to address this feedback.";
const legacyReplyTextPrefix = "@builderio please fix this in a reply.";

function messageHasBuilderHandoff(text: string): boolean {
  return (
    text.includes(replyTextPrefix) ||
    text.includes(plaintextBuilderReplyPrefix) ||
    text.includes(legacyReplyTextPrefix)
  );
}

type RelatedFeedbackItem = {
  id: string;
  sourceUrl: string | null;
  title: string;
};

const startedTriageRunStatuses = new Set([
  "submitted",
  "acknowledged",
  "running",
  "completed",
  "timed_out",
  "reconciliation_required",
]);

export function hasFeedbackCluster(metadata: Record<string, unknown>): boolean {
  return (
    (typeof metadata.feedbackClusterRepresentativeId === "string" &&
      metadata.feedbackClusterRepresentativeId.trim().length > 0) ||
    (Array.isArray(metadata.feedbackClusterItemIds) &&
      metadata.feedbackClusterItemIds.length > 0)
  );
}

export function isStartedTriageRunStatus(status: string): boolean {
  return startedTriageRunStatuses.has(status);
}

export function relatedDispatchConflictReason(
  item: Pick<RelatedFeedbackItem, "id">,
  metadata: Record<string, unknown>,
  runStatuses: readonly string[],
): string | null {
  if (hasFeedbackCluster(metadata)) {
    return `Related Factory item ${item.id} already belongs to a feedback cluster.`;
  }
  if (runStatuses.some(isStartedTriageRunStatus)) {
    return `Related Factory item ${item.id} already has a started Builder run.`;
  }
  return null;
}

export function ownerOwnedAreaValuesForItem(
  item: Pick<RelatedFeedbackItem, "title"> & {
    summary: string | null;
    repository: string | null;
  },
  metadata: Record<string, unknown>,
): Array<string | undefined> {
  return [
    item.title,
    item.summary ?? undefined,
    item.repository ?? undefined,
    typeof metadata.productArea === "string" ? metadata.productArea : undefined,
    typeof metadata.path === "string" ? metadata.path : undefined,
  ];
}

export function replyTextForItem(
  item: {
    id: string;
    sourceUrl: string | null;
  },
  relatedItems: RelatedFeedbackItem[] = [],
): string {
  const relatedText =
    relatedItems.length > 0
      ? [
          "Related feedback in the same issue cluster - inspect and fix all of these too:",
          ...relatedItems.map(
            (related) =>
              `- ${related.title} (${related.id})${related.sourceUrl ? `: ${related.sourceUrl}` : ""}`,
          ),
        ]
      : [];
  return [
    replyTextPrefix,
    `Factory item: ${item.id}`,
    item.sourceUrl ? `Source: ${item.sourceUrl}` : "",
    ...relatedText,
    "Please include the Factory item, every related item, and their source links in the PR description, and make sure the fix covers the whole cluster rather than one report.",
  ]
    .filter(Boolean)
    .join("\n");
}

function relatedFeedbackSummary(relatedItems: RelatedFeedbackItem[]): string {
  if (relatedItems.length === 0) return "";
  return [
    "Related feedback in the same issue cluster:",
    ...relatedItems.map(
      (related) =>
        `- ${related.title} (${related.id})${related.sourceUrl ? `: ${related.sourceUrl}` : ""}`,
    ),
    "Read and address every related report in one change.",
  ].join("\n");
}

async function writeMetadata(
  itemId: string,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const item = (
    await db
      .select({ metadataJson: triageItems.metadataJson })
      .from(triageItems)
      .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
      .limit(1)
  )[0];
  if (!item)
    throw new Error("Factory item disappeared while recording dispatch.");
  const metadata = parseTriageMetadata(item.metadataJson);
  Object.assign(metadata, patch);
  await db
    .update(triageItems)
    .set({
      metadataJson: serializeTriageMetadata(metadata),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
}

export async function recordAutomaticBuilderDecision(input: {
  itemId: string;
  userEmail: string;
  orgId: string;
  outcome: "propose_fix" | "needs_manual";
  reason: string;
  guardResults: Array<{ code: string; passed: boolean; reason: string }>;
}) {
  const id = stableId(
    "decision",
    input.orgId,
    input.itemId,
    "automatic-builder",
  );
  const now = new Date().toISOString();
  await getDb()
    .insert(triageDecisions)
    .values({
      id,
      itemId: input.itemId,
      ruleId: null,
      mode: "automation",
      outcome: input.outcome,
      reason: input.reason,
      guardResultsJson: JSON.stringify(input.guardResults),
      model: "factory-automation",
      promptVersion: 1,
      createdAt: now,
      ownerEmail: input.userEmail,
      orgId: input.orgId,
    })
    .onConflictDoUpdate({
      target: triageDecisions.id,
      set: {
        outcome: input.outcome,
        reason: input.reason,
        guardResultsJson: JSON.stringify(input.guardResults),
        createdAt: now,
        ownerEmail: input.userEmail,
      },
    });
  return id;
}

export default defineAction({
  description:
    "Start the governed clear-bug Builder flow for a Factory item, or record a skip with a reason when clearBug is false. Slack items stay in-thread: this action adds 👀 and pings Builder with a Slack user-id mention; do not post Slack messages or @handles yourself. Grouped Slack repeats share one Builder thread. GitHub issues and Sentry errors use the Builder agent run API. Owner-managed Clips, Design, and Content items are always left for their owner.",
  schema: z.object({
    itemId: z.string().min(1),
    clearBug: z.boolean(),
    reason: z.string().trim().min(1).max(4_000),
    productUxImplications: z.boolean().default(false),
    clearErrorReport: z.string().trim().max(8_000).optional(),
    relatedItemIds: z
      .array(z.string().trim().min(1))
      .max(10)
      .default([])
      .describe(
        "Other Factory item ids in the same verified feedback cluster; dispatches one Builder thread for the whole group.",
      ),
  }),
  http: false,
  run: async (
    {
      itemId,
      clearBug,
      reason,
      productUxImplications,
      clearErrorReport,
      relatedItemIds,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "builderDispatch",
    );
    const db = getDb();
    const item = (
      await db
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Factory item not found.");
    const metadata = parseTriageMetadata(item.metadataJson);
    const relatedIds = [...new Set(relatedItemIds)].filter(
      (relatedId) => relatedId !== itemId,
    );
    const relatedItems =
      relatedIds.length > 0
        ? await db
            .select()
            .from(triageItems)
            .where(
              and(
                eq(triageItems.orgId, orgId),
                inArray(triageItems.id, relatedIds),
              ),
            )
        : [];
    if (relatedItems.length !== relatedIds.length) {
      throw new Error("One or more related Factory items were not found.");
    }
    if (relatedItems.some((related) => related.source !== item.source)) {
      throw new Error(
        "Grouped Factory items must come from the same feedback source.",
      );
    }
    if (
      item.source === "slack" &&
      relatedItems.some((related) => !related.channelId || !related.threadTs)
    ) {
      throw new Error(
        "Grouped Slack feedback is missing a channel or thread identity.",
      );
    }
    const relatedMetadata = new Map(
      relatedItems.map((related) => [
        related.id,
        parseTriageMetadata(related.metadataJson),
      ]),
    );
    const relatedRunRows =
      relatedIds.length > 0
        ? await db
            .select({ itemId: triageRuns.itemId, status: triageRuns.status })
            .from(triageRuns)
            .where(
              and(
                eq(triageRuns.orgId, orgId),
                inArray(triageRuns.itemId, relatedIds),
              ),
            )
        : [];
    for (const related of relatedItems) {
      const conflictReason = relatedDispatchConflictReason(
        related,
        relatedMetadata.get(related.id) ?? {},
        relatedRunRows
          .filter((run) => run.itemId === related.id)
          .map((run) => run.status),
      );
      if (conflictReason) throw new Error(conflictReason);
    }
    const ownerOwnedArea = detectOwnerOwnedArea([
      item.title,
      item.summary,
      item.repository,
      typeof metadata.productArea === "string"
        ? metadata.productArea
        : undefined,
      typeof metadata.path === "string" ? metadata.path : undefined,
    ]);
    const relatedOwnerOwnedArea =
      relatedItems
        .map((related) =>
          detectOwnerOwnedArea(
            ownerOwnedAreaValuesForItem(
              related,
              relatedMetadata.get(related.id) ?? {},
            ),
          ),
        )
        .find(Boolean) ?? null;
    const ownerManagedArea = ownerOwnedArea ?? relatedOwnerOwnedArea ?? null;
    const guardResults = [
      {
        code: "unknown_change",
        passed: clearBug,
        reason: clearBug
          ? "The automation classified a concrete, reproducible bug or error report."
          : "The report is not a clear bug, so no external work was started.",
      },
      {
        code: "unknown_change",
        passed: !productUxImplications,
        reason: productUxImplications
          ? "Product or UX implications require manual ownership."
          : "No product or UX decision was detected.",
      },
      ...(ownerManagedArea
        ? [
            {
              code: "owner_owned",
              passed: false,
              reason: `${ownerManagedArea} is fully owned by its product owner and is excluded from autonomous Builder work.`,
            },
          ]
        : []),
    ];
    const blocked = guardResults.some((guard) => !guard.passed);
    const decisionId = await recordAutomaticBuilderDecision({
      itemId,
      userEmail,
      orgId,
      outcome: blocked ? "needs_manual" : "propose_fix",
      reason,
      guardResults,
    });
    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "start-builder-for-item",
        kind: "decision",
        itemId,
        source: item.source,
        sourceUrl: item.sourceUrl,
        status: blocked ? "skipped" : "success",
        summary: reason,
        details: {
          decisionId,
          clearBug,
          productUxImplications,
          ownerOwnedArea: ownerManagedArea,
          guardResults,
        },
      },
    );
    if (blocked) {
      await db
        .update(triageItems)
        .set({ status: "needs_manual", updatedAt: new Date().toISOString() })
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
      return {
        ok: true,
        started: false,
        needsManual: true,
        decisionId,
        reason,
      };
    }

    const dedupeKey = stableId("automatic-builder", orgId, itemId);
    const runId = stableId("run", dedupeKey);
    const now = new Date().toISOString();
    const isSlack = item.source === "slack";
    const existing = (
      await db
        .select()
        .from(triageRuns)
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)))
        .limit(1)
    )[0];
    const retryableSlackRun =
      isSlack &&
      existing &&
      (existing.status === "failed" || existing.status === "cancelled");
    if (existing && !retryableSlackRun) {
      return {
        ok: true,
        started: true,
        deduplicated: true,
        runId,
        status: existing.status,
      };
    }

    if (retryableSlackRun) {
      await db
        .update(triageRuns)
        .set({
          status: "submitted",
          error: null,
          completedAt: null,
          heartbeatAt: now,
          dispatchAttempts: (existing.dispatchAttempts ?? 0) + 1,
        })
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)));
    } else {
      await db.insert(triageRuns).values({
        id: runId,
        itemId,
        source: item.source,
        provider: isSlack ? "bot-tag" : "builder-http",
        dedupeKey,
        approvalEmail: null,
        status: "submitted",
        progressLogJson: JSON.stringify([
          {
            at: now,
            state: "submitted",
            reason: `Factory automation ${context?.automation?.triggerName ?? "unknown"} recorded a clear bug.`,
          },
        ]),
        dispatchAttempts: 1,
        needsContinuation: 0,
        startedAt: now,
        heartbeatAt: now,
        completedAt: null,
        error: null,
        ownerEmail: item.ownerEmail,
        orgId,
      });
    }

    try {
      if (isSlack) {
        if (!item.channelId || !item.threadTs) {
          throw new Error(
            "Slack feedback is missing its channel or thread identity.",
          );
        }
        const config = (
          await db
            .select({ slackWorkspace: triageConfig.slackWorkspace })
            .from(triageConfig)
            .where(
              and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)),
            )
            .limit(1)
        )[0];
        const workspace =
          config?.slackWorkspace === "secondary" ? "secondary" : "primary";
        const slack = createSlackReader({ ownerEmail: userEmail, orgId });
        const thread = await slack.getCompleteThread(
          workspace,
          item.channelId,
          item.threadTs,
        );
        const completeThreads = new Map([[item.id, thread]]);
        if (thread.hasMore) {
          throw new Error(
            "Slack thread is truncated; refusing to dispatch without complete evidence.",
          );
        }
        for (const related of relatedItems) {
          if (!related.channelId || !related.threadTs) {
            throw new Error(
              "Grouped Slack feedback is missing a channel or thread identity.",
            );
          }
          const relatedThread = await slack.getCompleteThread(
            workspace,
            related.channelId,
            related.threadTs,
          );
          completeThreads.set(related.id, relatedThread);
          if (relatedThread.hasMore) {
            throw new Error(
              "A grouped Slack thread is truncated; refusing to dispatch without complete evidence.",
            );
          }
        }
        for (const feedbackItem of [item, ...relatedItems]) {
          const reactionState = await slack.getEyesReaction(
            workspace,
            feedbackItem.channelId!,
            feedbackItem.threadTs!,
          );
          const reaction = reactionState.eyesPresent
            ? { added: false, already_present: true }
            : await slack.addEyesReaction(
                workspace,
                feedbackItem.channelId!,
                feedbackItem.threadTs!,
              );
          await writeMetadata(feedbackItem.id, orgId, {
            slackEyesReactedAt: new Date().toISOString(),
            slackEyesReactionAlreadyPresent: reaction.already_present,
          });
        }
        const hasBuilderReply = thread.messages.some((message) =>
          messageHasBuilderHandoff(message.text),
        );
        const hasRelatedClusterDetails = thread.messages.some((message) =>
          message.text.includes(
            "Related feedback in the same issue cluster - inspect and fix all of these too:",
          ),
        );
        if (thread.hasMore && !hasBuilderReply) {
          throw new Error(
            "Slack thread is truncated; refusing to risk a duplicate Builder handoff.",
          );
        }
        if (
          !metadataBoolean(metadata, "slackBuilderReplyAt") &&
          (!hasBuilderReply ||
            (relatedItems.length > 0 && !hasRelatedClusterDetails))
        ) {
          const posted = await slack.postThreadReply(
            workspace,
            item.channelId,
            item.threadTs,
            replyTextForItem(item, relatedItems),
          );
          await writeMetadata(itemId, orgId, {
            slackBuilderReplyAt: new Date().toISOString(),
            slackBuilderReplyTs: posted.ts,
          });
        }
        const agentNative = await slack.getAgentNativeIdentity(workspace);
        for (const feedbackItem of [item, ...relatedItems]) {
          const feedbackThread = completeThreads.get(feedbackItem.id);
          if (!feedbackThread) {
            throw new Error(
              `Slack thread evidence is missing for Factory item ${feedbackItem.id}.`,
            );
          }
          const hasAgentNativeDisposition = feedbackThread.messages.some(
            (message) =>
              (message.user === agentNative.userId ||
                message.username?.trim().toLowerCase() === "agent-native") &&
              /^(Fixed|In progress|Clarification needed):/i.test(
                message.text.trim(),
              ),
          );
          if (hasAgentNativeDisposition) continue;
          const disposition = await slack.postThreadReply(
            workspace,
            feedbackItem.channelId!,
            feedbackItem.threadTs!,
            `Thanks - Builder owns this feedback cluster and will follow up after verification. In progress: ${reason}`,
          );
          await writeMetadata(feedbackItem.id, orgId, {
            slackDispositionAt: new Date().toISOString(),
            slackDispositionTs: disposition.ts,
            slackDisposition: "In progress",
          });
        }
        const clusterItemIds = [itemId, ...relatedItems.map(({ id }) => id)];
        const clusterMetadata = {
          feedbackClusterRepresentativeId: itemId,
          feedbackClusterItemIds: clusterItemIds,
          feedbackClusterGroupedAt: new Date().toISOString(),
        };
        await writeMetadata(itemId, orgId, clusterMetadata);
        for (const related of relatedItems) {
          await writeMetadata(related.id, orgId, clusterMetadata);
          await db
            .update(triageItems)
            .set({
              status: "automation_started",
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(eq(triageItems.id, related.id), eq(triageItems.orgId, orgId)),
            );
          await recordAutomaticBuilderDecision({
            itemId: related.id,
            userEmail,
            orgId,
            outcome: "propose_fix",
            reason: `Grouped with Factory item ${itemId}: ${reason}`,
            guardResults,
          });
        }
        await db
          .update(triageItems)
          .set({
            status: "automation_started",
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "start-builder-for-item",
            kind: "external_action",
            itemId,
            source: item.source,
            sourceUrl: item.sourceUrl,
            summary: "Tagged Builder in the Slack thread and requested a PR.",
            details: {
              provider: "bot-tag",
              runId,
              relatedItemIds: relatedItems.map(({ id }) => id),
            },
          },
        );
        return {
          ok: true,
          started: true,
          deduplicated: false,
          runId,
          provider: "bot-tag",
          awaitingBuilderReply: true,
        };
      }

      const result = await startBuilderRun({
        runId,
        itemId,
        ownerEmail: userEmail,
        orgId,
        repository: item.repository,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        instructions: [
          "Run /address-feedback in the repository and read the address-feedback, address-feedback-with-replies, review-latest-feedback, and review-prs skills as relevant. Inspect all linked evidence and repeat reports, then fix the smallest owning boundary and verify it before opening the PR.",
          reason,
          clearErrorReport ? `Error report:\n${clearErrorReport}` : "",
          relatedFeedbackSummary(relatedItems),
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      await db
        .update(triageRuns)
        .set({
          status: "acknowledged",
          providerTaskId: result.providerTaskId ?? null,
          progressLogJson: JSON.stringify([
            { at: now, state: "submitted", reason },
            {
              at: new Date().toISOString(),
              state: "acknowledged",
              reason:
                "Builder accepted the fire-and-forget request; waiting for the signed callback.",
            },
          ]),
          heartbeatAt: new Date().toISOString(),
        })
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)));
      await writeMetadata(itemId, orgId, {
        builderProviderTaskId: result.providerTaskId ?? null,
        builderBranchName: result.branchName,
      });
      await db
        .update(triageItems)
        .set({
          status: "automation_started",
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "start-builder-for-item",
          kind: "external_action",
          itemId,
          source: item.source,
          sourceUrl: item.sourceUrl,
          summary: "Submitted the clear bug to Builder.",
          details: {
            provider: "builder-http",
            runId,
            providerTaskId: result.providerTaskId ?? null,
          },
        },
      );
      return {
        ok: true,
        started: true,
        deduplicated: false,
        runId,
        provider: "builder-http",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(triageRuns)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        })
        .where(and(eq(triageRuns.id, runId), eq(triageRuns.orgId, orgId)));
      throw new Error(
        `Factory Builder dispatch failed after recording the run: ${message}`,
      );
    }
  },
});
