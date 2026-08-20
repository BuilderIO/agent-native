import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import {
  factoryIdSchema,
  readTriageConfigRow,
  triageConfigUpdateRowId,
} from "../server/lib/factory-scope.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
} from "../server/triage/review-state.js";
import { repairFactoryAutomationsFromConfig } from "../server/lib/factory-automation-repair.js";

export default defineAction({
  description:
    "Poll the configured Slack channel and append new messages to the Factory queue. This action only observes and never posts, replies, starts work, or changes a provider.",
  schema: z.object({
    factoryId: factoryIdSchema,
    channelId: z.string().trim().min(1).max(128).optional(),
  }),
  http: false,
  run: async ({ factoryId, channelId: requestedChannelId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "sourcePolling",
      factoryId,
    );
    const db = getDb();
    const config = await readTriageConfigRow(db, orgId, factoryId);
    await repairFactoryAutomationsFromConfig(userEmail, orgId, factoryId);
    if (config?.pollingEnabled !== 1) {
      throw new Error("Enable Slack polling before polling Slack.");
    }
    const channelId = requestedChannelId ?? config?.slackChannelId;
    if (!channelId) {
      throw new Error("Configure a Slack channel before polling.");
    }

    const result = await pollSlackChannel({
      workspace:
        config?.slackWorkspace === "secondary" ? "secondary" : "primary",
      channelId,
      priorLastSlackTs: config?.lastSlackTs ?? "0",
      historyCursor: config?.slackHistoryCursor,
      ownerEmail: userEmail,
      orgId,
    });
    const now = new Date().toISOString();
    const configRowId = triageConfigUpdateRowId(config, orgId, factoryId);

    await db.transaction(async (tx) => {
      for (const envelope of result.envelopes) {
        const id = itemDedupeKey(envelope, orgId, factoryId);
        const existing = (
          await tx
            .select()
            .from(triageItems)
            .where(and(eq(triageItems.id, id), eq(triageItems.orgId, orgId)))
            .limit(1)
        )[0];
        const sourceChanged = hasTriageSourceChanged(existing, {
          title: envelope.title,
          summary: envelope.summary ?? null,
          sourceUrl: envelope.sourceUrl ?? null,
          coverage: envelope.coverage,
          lastSeenAt:
            typeof envelope.metadata?.messageTs === "string"
              ? envelope.metadata.messageTs
              : undefined,
        });
        const status = statusAfterTriageSourceUpdate(
          existing?.status,
          sourceChanged,
          "received",
        );
        const updatedAt = sourceChanged ? now : (existing?.updatedAt ?? now);
        const sourceLastSeenAt =
          typeof envelope.metadata?.messageTs === "string"
            ? envelope.metadata.messageTs
            : now;
        const lastSeenAt = sourceChanged
          ? sourceLastSeenAt
          : (existing?.lastSeenAt ?? now);
        await tx
          .insert(triageItems)
          .values({
            id,
            source: envelope.source,
            externalId: envelope.externalId,
            sourceUrl: envelope.sourceUrl ?? null,
            title: envelope.title,
            summary: envelope.summary ?? null,
            status,
            risk: "unknown",
            channelId: envelope.channelId ?? null,
            threadTs: envelope.threadTs ?? null,
            repository: envelope.repository ?? null,
            pullRequestNumber: envelope.pullRequestNumber ?? null,
            headSha: envelope.headSha ?? null,
            coverage: envelope.coverage,
            dedupeKey: id,
            metadataJson: JSON.stringify(envelope.metadata ?? {}),
            lastSeenAt,
            createdAt: now,
            updatedAt,
            ownerEmail: userEmail,
            orgId,
            factoryId,
          })
          .onConflictDoUpdate({
            target: triageItems.id,
            set: {
              sourceUrl: envelope.sourceUrl ?? null,
              title: envelope.title,
              summary: envelope.summary ?? null,
              channelId: envelope.channelId ?? null,
              threadTs: envelope.threadTs ?? null,
              coverage: envelope.coverage,
              metadataJson: JSON.stringify(envelope.metadata ?? {}),
              status,
              lastSeenAt,
              updatedAt,
              factoryId,
            },
          });
      }

      if (config) {
        await tx
          .update(triageConfig)
          .set({
            lastSlackTs: result.nextLastSlackTs,
            slackHistoryCursor: result.nextHistoryCursor,
            updatedAt: now,
          })
          .where(
            and(
              eq(triageConfig.id, configRowId),
              eq(triageConfig.orgId, orgId),
            ),
          );
      }
    });

    if (result.envelopes.length === 0) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-slack-channel",
          kind: "observed",
          source: "slack",
          summary: "No new Slack feedback was observed.",
          details: {
            channelId,
            coverage: result.hasMore ? "partial" : "complete",
          },
        },
        factoryId,
      );
    } else {
      for (const envelope of result.envelopes) {
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "poll-slack-channel",
            kind: "observed",
            itemId: itemDedupeKey(envelope, orgId, factoryId),
            source: envelope.source,
            sourceUrl: envelope.sourceUrl ?? null,
            summary: envelope.summary ?? envelope.title,
            details: {
              channelId,
              threadTs: envelope.threadTs ?? null,
              coverage: envelope.coverage,
            },
          },
          factoryId,
        );
      }
    }

    return {
      ok: true,
      source: "slack",
      factoryId,
      channelId,
      observed: result.envelopes.length,
      hasMore: result.hasMore,
      nextLastSlackTs: result.nextLastSlackTs,
      nextHistoryCursor: result.nextHistoryCursor,
      coverage: result.hasMore ? "partial" : "complete",
    };
  },
});
