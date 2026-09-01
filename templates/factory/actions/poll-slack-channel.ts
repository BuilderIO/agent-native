import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { authorMatchesFilter } from "../server/lib/factory-automation-config.js";
import { repairFactoryAutomationsFromConfig } from "../server/lib/factory-automation-repair.js";
import {
  readFactoryPollCursor,
  writeFactoryPollCursor,
} from "../server/lib/factory-poll-cursors.js";
import {
  factoryIdSchema,
  factoryStillPresent,
  readTriageConfigRow,
  requireExistingFactory,
  triageConfigUpdateRowId,
} from "../server/lib/factory-scope.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import type { IngestionEnvelope } from "../server/triage/contracts.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
} from "../server/triage/review-state.js";
import { pollSlackChannel } from "../server/triage/slack-poller.js";

export default defineAction({
  description:
    "Poll the Slack channel for this Factory job and append new messages to the Factory queue. This action only observes and never posts, replies, starts work, or changes a provider.",
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
    const job = await readCallingFactoryAutomation(context, {
      userEmail,
      orgId,
    });
    const jobConfig = job?.config;
    const channelId =
      jobConfig?.slackChannelId?.trim() || config?.slackChannelId || "";
    if (!channelId) {
      throw new Error("Configure a Slack channel before polling.");
    }
    if (requestedChannelId && requestedChannelId !== channelId) {
      throw new Error("Poll only the Slack channel configured for this job.");
    }
    const workspace =
      jobConfig?.slackWorkspace === "secondary" ||
      config?.slackWorkspace === "secondary"
        ? "secondary"
        : "primary";
    const destinationKey = channelId;
    const storedCursor = await readFactoryPollCursor(
      db,
      orgId,
      factoryId,
      "slack",
      destinationKey,
    );
    const priorLastSlackTs =
      storedCursor?.lastSlackTs ?? config?.lastSlackTs ?? "0";
    const historyCursor =
      storedCursor?.slackHistoryCursor ?? config?.slackHistoryCursor;
    const inboxLimit = jobConfig?.inboxLimit ?? 25;

    const result = await pollSlackChannel({
      workspace,
      channelId,
      priorLastSlackTs,
      historyCursor,
      ownerEmail: userEmail,
      orgId,
    });
    const now = new Date().toISOString();
    const configRowId = config
      ? triageConfigUpdateRowId(config, orgId, factoryId)
      : null;
    const accepted: IngestionEnvelope[] = [];
    let nextLastSlackTs =
      result.envelopes.length === 0
        ? (result.nextLastSlackTs ?? priorLastSlackTs)
        : priorLastSlackTs;
    for (const envelope of result.envelopes) {
      const authorId =
        typeof envelope.metadata?.authorId === "string"
          ? envelope.metadata.authorId
          : typeof envelope.metadata?.author === "string"
            ? envelope.metadata.author
            : null;
      if (
        jobConfig &&
        !authorMatchesFilter(
          authorId,
          jobConfig.authorMode,
          jobConfig.authorIds,
        )
      ) {
        if (typeof envelope.metadata?.messageTs === "string") {
          nextLastSlackTs = envelope.metadata.messageTs;
        }
        continue;
      }
      accepted.push(envelope);
    }
    const truncatedByAuthor = accepted.length < result.envelopes.length;
    let nextHistoryCursor = truncatedByAuthor
      ? (historyCursor ?? null)
      : result.nextHistoryCursor;

    const ingested: IngestionEnvelope[] = [];
    const addedEnvelopes: IngestionEnvelope[] = [];
    let added = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      for (const envelope of accepted) {
        const id = itemDedupeKey(envelope, orgId, factoryId);
        const existing = (
          await tx
            .select()
            .from(triageItems)
            .where(and(eq(triageItems.id, id), eq(triageItems.orgId, orgId)))
            .limit(1)
        )[0];
        if (!existing && added >= inboxLimit) {
          nextHistoryCursor = historyCursor ?? null;
          break;
        }
        if (!existing) {
          added += 1;
          addedEnvelopes.push(envelope);
        } else {
          updated += 1;
        }
        ingested.push(envelope);
        if (typeof envelope.metadata?.messageTs === "string") {
          nextLastSlackTs = envelope.metadata.messageTs;
        }
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

      await writeFactoryPollCursor(tx as unknown as ReturnType<typeof getDb>, {
        orgId,
        factoryId,
        source: "slack",
        destinationKey,
        ownerEmail: userEmail,
        lastSlackTs: nextLastSlackTs,
        slackHistoryCursor: nextHistoryCursor,
      });
      if (config && configRowId) {
        await tx
          .update(triageConfig)
          .set({
            lastSlackTs: nextLastSlackTs,
            slackHistoryCursor: nextHistoryCursor,
            updatedAt: now,
          })
          .where(
            and(
              eq(triageConfig.id, configRowId),
              eq(triageConfig.orgId, orgId),
              factoryStillPresent(
                tx as unknown as ReturnType<typeof getDb>,
                orgId,
                factoryId,
              ),
            ),
          );
      }
      await requireExistingFactory(
        tx as unknown as ReturnType<typeof getDb>,
        orgId,
        factoryId,
      );
    });

    const truncatedByLimit = ingested.length < accepted.length;
    const authorFiltered = result.envelopes.length - accepted.length;
    const truncated = result.hasMore || truncatedByAuthor || truncatedByLimit;
    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "poll-slack-channel",
        kind: "observed",
        source: "slack",
        summary:
          added === 0
            ? "No new Slack feedback was observed."
            : `Added ${added} new Slack item${added === 1 ? "" : "s"}.`,
        details: {
          channelId,
          inboxLimit,
          added,
          updated,
          authorFiltered,
          newerThanCursor: result.envelopes.length,
          truncated,
          coverage: truncated ? "partial" : "complete",
          itemIds: addedEnvelopes.map((envelope) =>
            itemDedupeKey(envelope, orgId, factoryId),
          ),
        },
      },
      factoryId,
    );
    for (const envelope of addedEnvelopes) {
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
            added: true,
          },
        },
        factoryId,
      );
    }

    return {
      ok: true,
      source: "slack",
      factoryId,
      channelId,
      observed: ingested.length,
      hasMore: result.hasMore || truncated || truncatedByLimit,
      nextLastSlackTs,
      nextHistoryCursor,
      coverage:
        result.hasMore || truncated || truncatedByLimit
          ? "partial"
          : "complete",
    };
  },
});
