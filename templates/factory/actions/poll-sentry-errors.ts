import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
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
import { sentryPollObservationSummary } from "../server/lib/sentry-poll-summary.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import { mergeTriageMetadata } from "../server/triage/metadata.js";
import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
  triageSourceUpsertGuard,
} from "../server/triage/review-state.js";
import {
  createSentryClient,
  type SentryIssue,
} from "../server/triage/sentry-client.js";

/** The row a poll stores for an issue the inbox does not have yet. */
function newIssueRow(
  issue: SentryIssue,
  scope: {
    now: string;
    userEmail: string;
    orgId: string;
    factoryId: string;
    sentryOrgSlug: string;
  },
) {
  const id = itemDedupeKey(
    { source: "sentry", externalId: issue.id },
    scope.orgId,
    scope.factoryId,
  );
  return previewRowOf({
    id,
    source: "sentry",
    externalId: issue.id,
    sourceUrl: issue.permalink,
    title: issue.title,
    summary: [issue.culprit, `${issue.count} events`, issue.level]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 4_000),
    status: statusAfterTriageSourceUpdate(undefined, true, "received"),
    risk: "unknown",
    coverage: "complete",
    dedupeKey: id,
    metadataJson: mergeTriageMetadata("{}", {
      kind: "sentry_issue",
      sentryOrgSlug: scope.sentryOrgSlug,
      sentryIssueId: issue.id,
      shortId: issue.shortId,
      culprit: issue.culprit,
      level: issue.level,
      projectSlug: issue.projectSlug,
      errorReport: [issue.title, issue.culprit].filter(Boolean).join("\n"),
      count: issue.count,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
    }),
    lastSeenAt: issue.lastSeen,
    createdAt: scope.now,
    updatedAt: scope.now,
    ownerEmail: scope.userEmail,
    orgId: scope.orgId,
    factoryId: scope.factoryId,
  });
}

/** Sentry's largest page: a position is only as complete as the page that was read. */
const SENTRY_POSITION_PAGE = 100;

/** The page was full and its oldest issue is still after the position, so older new ones may lie beyond it. */
function pageEndsAfter(
  page: readonly { firstSeen: string }[],
  pageSize: number,
  startMs: number,
): boolean {
  return (
    page.length >= pageSize &&
    page.slice(-1).some((oldest) => Date.parse(oldest.firstSeen) > startMs)
  );
}

/**
 * Where a workflow source goes on from: past everything it read, or where it
 * was when something newer was left unread, so the next read finds the rest.
 */
function positionAfter(read: {
  after: string;
  observed: readonly { firstSeen: string }[];
  complete: boolean;
}): string {
  if (!read.complete) return read.after;
  return read.observed.reduce(
    (latest, issue) =>
      Date.parse(issue.firstSeen) > Date.parse(latest)
        ? issue.firstSeen
        : latest,
    read.after,
  );
}

export default defineAction({
  description:
    "Poll bounded unresolved Sentry issues for the configured organization and record them in the Factory queue. This does not change Sentry.",
  schema: z.object({
    factoryId: factoryIdSchema,
    limit: z.number().int().min(1).max(50).default(25),
    ...pollStartFields,
  }),
  http: false,
  run: async ({ factoryId, limit, after, prime, preview }, context) => {
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
    const sentryOrgSlug =
      job?.config.sentryOrgSlug?.trim() || config?.sentryOrgSlug || "";
    const sentryProjectSlug =
      job?.config.sentryProjectSlug?.trim() || config?.sentryProjectSlug || "";
    const sentryEnvironment =
      job?.config.sentryEnvironment?.trim() || config?.sentryEnvironment || "";
    if (!sentryOrgSlug) {
      throw new Error("Configure a Sentry organization before polling Sentry.");
    }
    const inboxLimit = Math.min(job?.config.inboxLimit ?? 25, limit);
    const destinationKey = `${sentryOrgSlug}/${sentryProjectSlug}`;
    // A workflow source that has a position keeps its own: the factory-wide
    // cursor is shared with every other reader of this project, so it is
    // neither read nor moved.
    const ownsPosition = after !== undefined || prime === true;
    const storedCursor = ownsPosition
      ? null
      : await readFactoryPollCursor(
          db,
          orgId,
          factoryId,
          "sentry",
          destinationKey,
        );
    const query = [
      "is:unresolved",
      sentryProjectSlug ? `project:${sentryProjectSlug}` : "",
      sentryEnvironment ? `environment:${sentryEnvironment}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const client = createSentryClient({
      ownerEmail: userEmail,
      orgId,
      orgSlug: sentryOrgSlug,
    });
    // Newest first by first-seen time, because "new" is what a position
    // compares: the busiest-first order the legacy poll reads in would leave a
    // new issue out of a short page.
    const firstRead = prime === true && preview !== true;
    const fetchLimit = ownsPosition
      ? firstRead
        ? 1
        : prime === true
          ? inboxLimit
          : SENTRY_POSITION_PAGE
      : inboxLimit;
    const issues = ownsPosition
      ? await client.listIssues(query, fetchLimit, { sort: "new" })
      : await client.listIssues(query, fetchLimit);
    for (const issue of issues) {
      if (Number.isNaN(Date.parse(issue.firstSeen))) {
        throw new Error(
          `Sentry issue ${issue.id} has an invalid firstSeen timestamp.`,
        );
      }
    }
    if (firstRead) {
      // A workflow source's first live read: the newest position only, and
      // nothing stored, so the issues that are already there are never brought in.
      const position = issues[0]?.firstSeen ?? new Date().toISOString();
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-sentry-errors",
          kind: "observed",
          source: "sentry",
          summary:
            "Started reading Sentry from now; issues that were already there were not brought in.",
          details: { sentryOrgSlug, primed: true, position },
        },
        factoryId,
      );
      return {
        ok: true,
        factoryId,
        observed: 0,
        fetched: issues.length,
        sentryOrgSlug,
        primed: true,
        position,
      };
    }
    const startMs = after === undefined ? null : Date.parse(after);
    if (startMs !== null && Number.isNaN(startMs)) {
      // guard:allow-bare-error — invariant: the position is the one this action's own answer gave the host
      throw new Error("The saved Sentry position is not a valid timestamp.");
    }
    const lastSentrySeenAt = ownsPosition
      ? null
      : (storedCursor?.lastSentrySeenAt ?? config?.lastSentrySeenAt ?? null);
    const cursor = lastSentrySeenAt ? Date.parse(lastSentrySeenAt) : null;
    if (cursor !== null && Number.isNaN(cursor)) {
      // guard:allow-bare-error — invariant: this action wrote the cursor, so an unreadable one is a bug
      throw new Error("Stored Sentry polling cursor is not a valid timestamp.");
    }
    const observedIssues =
      startMs === null
        ? issues
        : issues.filter((issue) => Date.parse(issue.firstSeen) > startMs);
    const now = new Date().toISOString();
    const configRowId = config
      ? triageConfigUpdateRowId(config, orgId, factoryId)
      : null;
    let added = 0;
    let updated = 0;
    const addedIds: string[] = [];
    const nextSentrySeenAt =
      observedIssues.reduce<string | null>((latest, issue) => {
        if (!latest) return issue.firstSeen;
        return Date.parse(issue.firstSeen) > Date.parse(latest)
          ? issue.firstSeen
          : latest;
      }, lastSentrySeenAt) ?? lastSentrySeenAt;

    const addedIssues: SentryIssue[] = [];
    const ingest = async (tx: ReturnType<typeof getDb>) => {
      for (const issue of observedIssues) {
        const id = itemDedupeKey(
          { source: "sentry", externalId: issue.id },
          orgId,
          factoryId,
        );
        const existing = (
          await tx
            .select()
            .from(triageItems)
            .where(and(eq(triageItems.id, id), eq(triageItems.orgId, orgId)))
            .limit(1)
        )[0];
        if (!existing && added >= inboxLimit) continue;
        if (!existing) {
          added += 1;
          addedIds.push(id);
          addedIssues.push(issue);
        } else {
          updated += 1;
        }
        const metadata = mergeTriageMetadata(existing?.metadataJson ?? "{}", {
          kind: "sentry_issue",
          sentryOrgSlug,
          sentryIssueId: issue.id,
          shortId: issue.shortId,
          culprit: issue.culprit,
          level: issue.level,
          projectSlug: issue.projectSlug,
          errorReport: [issue.title, issue.culprit].filter(Boolean).join("\n"),
          count: issue.count,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
        });
        const summary = [issue.culprit, `${issue.count} events`, issue.level]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 4_000);
        const sourceChanged = hasTriageSourceChanged(existing, {
          sourceUrl: issue.permalink,
          title: issue.title,
          summary,
          lastSeenAt: issue.lastSeen,
        });
        const status = statusAfterTriageSourceUpdate(
          existing?.status,
          sourceChanged,
          "received",
        );
        const updatedAt = sourceChanged ? now : (existing?.updatedAt ?? now);
        const lastSeenAt = sourceChanged
          ? issue.lastSeen
          : (existing?.lastSeenAt ?? issue.lastSeen);
        // A preview stores nothing; its rows are made below from what was new.
        if (preview === true) continue;
        await tx
          .insert(triageItems)
          .values({
            id,
            source: "sentry",
            externalId: issue.id,
            sourceUrl: issue.permalink,
            title: issue.title,
            summary,
            status,
            risk: existing?.risk ?? "unknown",
            coverage: existing?.coverage ?? "complete",
            dedupeKey: id,
            metadataJson: metadata,
            lastSeenAt,
            createdAt: existing?.createdAt ?? now,
            updatedAt,
            ownerEmail: existing?.ownerEmail ?? userEmail,
            orgId,
            factoryId,
          })
          .onConflictDoUpdate({
            target: triageItems.id,
            set: {
              sourceUrl: issue.permalink,
              title: issue.title,
              summary,
              status,
              metadataJson: metadata,
              lastSeenAt,
              updatedAt,
              factoryId,
            },
            setWhere: triageSourceUpsertGuard(existing, status, now),
          });
      }

      if (preview !== true && !ownsPosition) {
        await writeFactoryPollCursor(tx, {
          orgId,
          factoryId,
          source: "sentry",
          destinationKey,
          ownerEmail: userEmail,
          lastSentrySeenAt: nextSentrySeenAt,
        });
        if (config && configRowId) {
          await tx
            .update(triageConfig)
            .set({
              lastSentrySeenAt: nextSentrySeenAt,
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
    // Every observed issue was added, updated or left for the next read because the inbox was full.
    const droppedByInboxLimit = observedIssues.length - added - updated;

    if (preview === true) {
      // A preview stores nothing, so it leaves no audit row either.
      const sample = boundPreviewRows(
        addedIssues.map((issue) =>
          newIssueRow(issue, {
            now,
            userEmail,
            orgId,
            factoryId,
            sentryOrgSlug,
          }),
        ),
      );
      return {
        ok: true,
        factoryId,
        observed: observedIssues.length - droppedByInboxLimit,
        fetched: issues.length,
        sentryOrgSlug,
        preview: true,
        previewRows: sample.rows,
        previewTotal: sample.total,
      };
    }

    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "poll-sentry-errors",
        kind: "observed",
        source: "sentry",
        summary: sentryPollObservationSummary(observedIssues.length, added),
        details: {
          sentryOrgSlug,
          inboxLimit,
          added,
          updated,
          newlyObserved: added,
          truncated: added + updated < observedIssues.length,
          itemIds: addedIds,
        },
      },
      factoryId,
    );
    if (observedIssues.length > 0) {
      for (const issue of observedIssues) {
        const itemId = itemDedupeKey(
          { source: "sentry", externalId: issue.id },
          orgId,
          factoryId,
        );
        if (!addedIds.includes(itemId)) continue;
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "poll-sentry-errors",
            kind: "observed",
            itemId,
            source: "sentry",
            sourceUrl: issue.permalink,
            summary: issue.title,
            details: {
              shortId: issue.shortId,
              level: issue.level,
              count: issue.count,
              projectSlug: issue.projectSlug,
              added: true,
            },
          },
          factoryId,
        );
      }
    }

    return {
      ok: true,
      factoryId,
      // What the inbox holds of them: an issue left for the next read because
      // the inbox was full is not observed yet, and must not read as stored.
      observed: observedIssues.length - droppedByInboxLimit,
      fetched: issues.length,
      sentryOrgSlug,
      ...(after !== undefined && startMs !== null
        ? {
            position: positionAfter({
              after,
              observed: observedIssues,
              // Something newer than the position was left unread: more
              // issues than the inbox takes at once, or a page that was all new.
              complete:
                droppedByInboxLimit === 0 &&
                !pageEndsAfter(issues, fetchLimit, startMs),
            }),
          }
        : {}),
    };
  },
});
