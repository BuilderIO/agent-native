import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
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

const replyTextPrefix =
  "@builderio please fix this in a reply. This is a clear bug based on the feedback above. Please send a PR when ready.";

function replyTextForItem(item: {
  id: string;
  sourceUrl: string | null;
}): string {
  return [
    replyTextPrefix,
    `Factory item: ${item.id}`,
    item.sourceUrl ? `Source: ${item.sourceUrl}` : "",
    "Please include the Factory item and source link in the PR description.",
  ]
    .filter(Boolean)
    .join("\n");
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

async function recordDecision(input: {
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
      createdAt: new Date().toISOString(),
      ownerEmail: input.userEmail,
      orgId: input.orgId,
    })
    .onConflictDoNothing();
  return id;
}

export default defineAction({
  description:
    "Start the governed clear-bug Builder flow for a Factory item. Slack items are kept in-thread by adding 👀 and tagging @builderio; GitHub issues and Sentry errors use the Builder agent run API. Owner-managed Clips, Design, and Content items are always left for their owner.",
  schema: z.object({
    itemId: z.string().min(1),
    clearBug: z.boolean(),
    reason: z.string().trim().min(1).max(4_000),
    productUxImplications: z.boolean().default(false),
    clearErrorReport: z.string().trim().max(8_000).optional(),
  }),
  http: false,
  run: async (
    { itemId, clearBug, reason, productUxImplications, clearErrorReport },
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
    const ownerOwnedArea = detectOwnerOwnedArea([
      item.title,
      item.summary,
      item.repository,
      typeof metadata.productArea === "string"
        ? metadata.productArea
        : undefined,
      typeof metadata.path === "string" ? metadata.path : undefined,
    ]);
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
      ...(ownerOwnedArea
        ? [
            {
              code: "owner_owned",
              passed: false,
              reason: `${ownerOwnedArea} is fully owned by its product owner and is excluded from autonomous Builder work.`,
            },
          ]
        : []),
    ];
    const blocked = guardResults.some((guard) => !guard.passed);
    const decisionId = await recordDecision({
      itemId,
      userEmail,
      orgId,
      outcome: blocked ? "needs_manual" : "propose_fix",
      reason: blocked
        ? guardResults
            .filter((guard) => !guard.passed)
            .map((guard) => guard.reason)
            .join(" ")
        : reason,
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
        summary: blocked ? "Factory kept this item for manual review." : reason,
        details: {
          decisionId,
          clearBug,
          productUxImplications,
          ownerOwnedArea: ownerOwnedArea ?? null,
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
        reason: guardResults
          .filter((guard) => !guard.passed)
          .map((guard) => guard.reason)
          .join(" "),
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
        if (!metadataBoolean(metadata, "slackEyesReactedAt")) {
          const reaction = await slack.addEyesReaction(
            workspace,
            item.channelId,
            item.threadTs,
          );
          await writeMetadata(itemId, orgId, {
            slackEyesReactedAt: new Date().toISOString(),
            slackEyesReactionAlreadyPresent: reaction.already_present,
          });
        }
        const thread = await slack.getThread(
          workspace,
          item.channelId,
          item.threadTs,
          100,
        );
        if (
          thread.has_more &&
          !thread.messages.some((message) =>
            message.text.includes(replyTextPrefix),
          )
        ) {
          throw new Error(
            "Slack thread is truncated; refusing to risk a duplicate Builder handoff.",
          );
        }
        if (
          !metadataBoolean(metadata, "slackBuilderReplyAt") &&
          !thread.messages.some((message) =>
            message.text.includes(replyTextPrefix),
          )
        ) {
          const posted = await slack.postThreadReply(
            workspace,
            item.channelId,
            item.threadTs,
            replyTextForItem(item),
          );
          await writeMetadata(itemId, orgId, {
            slackBuilderReplyAt: new Date().toISOString(),
            slackBuilderReplyTs: posted.ts,
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
            details: { provider: "bot-tag", runId },
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
          reason,
          clearErrorReport ? `Error report:\n${clearErrorReport}` : "",
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
