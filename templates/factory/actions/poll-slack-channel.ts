import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { authorMatchesFilter } from "../server/lib/factory-automation-config.js";
import {
  readFactoryPollCursor,
  writeFactoryPollCursor,
} from "../server/lib/factory-poll-cursors.js";
import {
  assertPollStart,
  boundPreviewRows,
  pollStartFields,
  previewRowOf,
} from "../server/lib/factory-poll-start.js";
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
import { mergeTriageMetadata } from "../server/triage/metadata.js";
import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
  triageSourceUpsertGuard,
} from "../server/triage/review-state.js";
import {
  pollSlackChannel,
  readNewestSlackTs,
} from "../server/triage/slack-poller.js";

/** The row a poll stores for a message the inbox does not have yet. */
function newMessageRow(
  envelope: IngestionEnvelope,
  scope: { now: string; userEmail: string; orgId: string; factoryId: string },
) {
  const messageTs = envelope.metadata?.messageTs;
  const seenAt = typeof messageTs === "string" ? messageTs : scope.now;
  return previewRowOf({
    id: itemDedupeKey(envelope, scope.orgId, scope.factoryId),
    source: envelope.source,
    externalId: envelope.externalId,
    sourceUrl: envelope.sourceUrl ?? null,
    title: envelope.title,
    summary: envelope.summary ?? null,
    status: statusAfterTriageSourceUpdate(undefined, true, "received"),
    risk: "unknown",
    channelId: envelope.channelId ?? null,
    threadTs: envelope.threadTs ?? null,
    repository: envelope.repository ?? null,
    pullRequestNumber: envelope.pullRequestNumber ?? null,
    headSha: envelope.headSha ?? null,
    coverage: envelope.coverage,
    dedupeKey: itemDedupeKey(envelope, scope.orgId, scope.factoryId),
    metadataJson: mergeTriageMetadata("{}", envelope.metadata ?? {}),
    lastSeenAt: seenAt,
    createdAt: scope.now,
    updatedAt: scope.now,
    ownerEmail: scope.userEmail,
    orgId: scope.orgId,
    factoryId: scope.factoryId,
  });
}

export default defineAction({
  description:
    "Poll the Slack channel for this Factory job and append new messages to the Factory queue. This action only observes and never posts, replies, starts work, or changes a provider.",
  schema: z.object({
    factoryId: factoryIdSchema,
    channelId: z.string().trim().min(1).max(128).optional(),
    ...pollStartFields,
    skipOwnPosts: z
      .boolean()
      .optional()
      .describe(
        "Workflow engine only. Leave this app's own Slack posts out of what is read: its notices and replies are its output, not new reports. They still move the position and are counted in skippedOwn. Fails with slack_identity_unresolved, taking nothing, when the app cannot say who it is.",
      ),
    headlines: z
      .boolean()
      .optional()
      .describe(
        "Workflow engine only. Record a one-line headline from each message's own words in the row's metadata, and whether the stored summary is cut short of the message. The row's title is unchanged. Without it a poll stores what it always did.",
      ),
  }),
  http: false,
  run: async (
    {
      factoryId,
      channelId: requestedChannelId,
      after,
      prime,
      preview,
      skipOwnPosts,
      headlines,
    },
    context,
  ) => {
    assertPollStart({ after, prime });
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
    const job = await readCallingFactoryAutomation(context, {
      userEmail,
      orgId,
    });
    const jobConfig = job?.config;
    const channelId =
      jobConfig?.slackChannelId?.trim() || config?.slackChannelId || "";
    if (!channelId) {
      fail(
        "Configure a Slack channel before polling: set the Slack channel ID on the workflow's inbox Source node (filter.scopes), or on the factory's settings as a fallback.",
        { statusCode: 400 },
      );
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
    const inboxLimit = jobConfig?.inboxLimit ?? 25;

    if (prime === true && preview !== true) {
      // A workflow source's first live read: the newest position only. Nothing
      // is stored and the factory-wide cursor is not touched, so the history
      // that is already there is never brought into the inbox.
      const newestTs = await readNewestSlackTs({
        workspace,
        channelId,
        ownerEmail: userEmail,
        orgId,
      });
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-slack-channel",
          kind: "observed",
          source: "slack",
          summary:
            "Started reading the Slack channel from now; messages that were already there were not brought in.",
          details: { channelId, primed: true, position: newestTs ?? "0" },
        },
        factoryId,
      );
      return {
        ok: true,
        source: "slack",
        factoryId,
        channelId,
        observed: 0,
        primed: true,
        position: newestTs ?? "0",
        hasMore: false,
        coverage: "complete",
        // Nothing is read for a post to be left out of.
        ...(skipOwnPosts === true ? { skippedOwn: 0 } : {}),
      };
    }

    // A workflow source that has a position keeps its own: the factory-wide
    // cursor is shared with every other reader of this channel, so it is
    // neither read nor moved.
    const ownsPosition = after !== undefined || prime === true;
    const storedCursor = ownsPosition
      ? null
      : await readFactoryPollCursor(
          db,
          orgId,
          factoryId,
          "slack",
          destinationKey,
        );
    const priorLastSlackTs =
      after ??
      (prime === true
        ? "0"
        : (storedCursor?.lastSlackTs ?? config?.lastSlackTs ?? "0"));
    const historyCursor = ownsPosition
      ? undefined
      : (storedCursor?.slackHistoryCursor ?? config?.slackHistoryCursor);

    const result = await pollSlackChannel({
      workspace,
      channelId,
      priorLastSlackTs,
      historyCursor,
      ownerEmail: userEmail,
      orgId,
      ...(prime === true ? { newest: inboxLimit } : {}),
      ...(skipOwnPosts === true ? { skipOwn: true } : {}),
      ...(headlines === true ? { headlines: true } : {}),
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
    let nextHistoryCursor = result.nextHistoryCursor;

    const ingested: IngestionEnvelope[] = [];
    const addedEnvelopes: IngestionEnvelope[] = [];
    let added = 0;
    let updated = 0;
    const ingest = async (tx: ReturnType<typeof getDb>) => {
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
        const metadataJson = mergeTriageMetadata(
          existing?.metadataJson ?? "{}",
          envelope.metadata ?? {},
        );
        // A preview stores nothing; its rows are made below from what was new.
        if (preview === true) continue;
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
            metadataJson,
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
              metadataJson,
              status,
              lastSeenAt,
              updatedAt,
              factoryId,
            },
            setWhere: triageSourceUpsertGuard(existing, status, now),
          });
      }

      // The app's own posts after the last message ingested are behind the
      // position too: the next read does not meet them, or count them, again.
      if (
        result.trailingOwnTs !== undefined &&
        ingested.length === accepted.length &&
        !result.hasMore
      ) {
        nextLastSlackTs = result.trailingOwnTs;
      }

      if (preview !== true && !ownsPosition) {
        await writeFactoryPollCursor(tx, {
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
                factoryStillPresent(tx, orgId, factoryId),
              ),
            );
        }
      }
      await requireExistingFactory(tx, orgId, factoryId);
    };
    if (preview === true) await ingest(db);
    else {
      await db.transaction(async (tx) =>
        ingest(tx as unknown as ReturnType<typeof getDb>),
      );
    }

    const truncatedByLimit = ingested.length < accepted.length;
    const authorFiltered = result.envelopes.length - accepted.length;
    const truncated = result.hasMore || truncatedByAuthor || truncatedByLimit;
    if (preview === true) {
      // A preview stores nothing, so it leaves no audit row either.
      const sample = boundPreviewRows(
        addedEnvelopes.map((envelope) =>
          newMessageRow(envelope, {
            now,
            userEmail,
            orgId,
            factoryId,
          }),
        ),
      );
      return {
        ok: true,
        source: "slack",
        factoryId,
        channelId,
        observed: ingested.length,
        hasMore: truncated,
        nextLastSlackTs,
        nextHistoryCursor,
        coverage: truncated ? "partial" : "complete",
        preview: true,
        previewRows: sample.rows,
        previewTotal: sample.total,
        ...(result.skippedOwn === undefined
          ? {}
          : { skippedOwn: result.skippedOwn }),
      };
    }
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
          ...(result.skippedOwn === undefined
            ? {}
            : { skippedOwn: result.skippedOwn }),
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
      // The position a workflow source saves: where this read left off.
      ...(ownsPosition ? { position: nextLastSlackTs } : {}),
      ...(result.skippedOwn === undefined
        ? {}
        : { skippedOwn: result.skippedOwn }),
    };
  },
});
