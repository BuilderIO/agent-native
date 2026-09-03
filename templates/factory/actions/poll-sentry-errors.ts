import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
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
import { sentryPollObservationSummary } from "../server/lib/sentry-poll-summary.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import { mergeTriageMetadata } from "../server/triage/metadata.js";
import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
} from "../server/triage/review-state.js";
import { createSentryClient } from "../server/triage/sentry-client.js";

export default defineAction({
  description:
    "Poll bounded unresolved Sentry issues for the configured organization and record them in the Factory queue. This does not change Sentry.",
  schema: z.object({
    factoryId: factoryIdSchema,
    limit: z.number().int().min(1).max(50).default(25),
  }),
  http: false,
  run: async ({ factoryId, limit }, context) => {
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
    const storedCursor = await readFactoryPollCursor(
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
    const issues = await createSentryClient({
      ownerEmail: userEmail,
      orgId,
      orgSlug: sentryOrgSlug,
    }).listIssues(query, inboxLimit);
    const lastSentrySeenAt =
      storedCursor?.lastSentrySeenAt ?? config?.lastSentrySeenAt ?? null;
    const cursor = lastSentrySeenAt ? Date.parse(lastSentrySeenAt) : null;
    if (cursor !== null && Number.isNaN(cursor)) {
      throw new Error("Stored Sentry polling cursor is not a valid timestamp.");
    }
    // Reconcile every bounded result by its stable Sentry issue id. Frequency
    // ordering is not a safe timestamp cursor: an older issue can re-enter the
    // top page after its frequency changes.
    for (const issue of issues) {
      const firstSeen = Date.parse(issue.firstSeen);
      if (Number.isNaN(firstSeen))
        throw new Error(
          `Sentry issue ${issue.id} has an invalid firstSeen timestamp.`,
        );
    }
    const observedIssues = issues;
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

    await db.transaction(async (tx) => {
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
        } else {
          updated += 1;
        }
        const metadata = mergeTriageMetadata(existing?.metadataJson ?? "{}", {
          kind: "sentry_issue",
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
          });
      }

      await writeFactoryPollCursor(tx as unknown as ReturnType<typeof getDb>, {
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
          authorFiltered: 0,
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
      observed: observedIssues.length,
      fetched: issues.length,
      sentryOrgSlug,
    };
  },
});
