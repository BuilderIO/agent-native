import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
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
  schema: z.object({ limit: z.number().int().min(1).max(50).default(25) }),
  http: false,
  run: async ({ limit }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "sourcePolling",
    );
    const config = (
      await getDb()
        .select()
        .from(triageConfig)
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
        .limit(1)
    )[0];
    if (config?.sentryPollingEnabled !== 1) {
      throw new Error("Enable Sentry polling before polling Sentry.");
    }
    if (!config.sentryOrgSlug) {
      throw new Error("Configure a Sentry organization before polling Sentry.");
    }
    const query = [
      "is:unresolved",
      config.sentryProjectSlug ? `project:${config.sentryProjectSlug}` : "",
      config.sentryEnvironment ? `environment:${config.sentryEnvironment}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const issues = await createSentryClient({
      ownerEmail: userEmail,
      orgId,
      orgSlug: config.sentryOrgSlug,
    }).listIssues(query, limit);
    const cursor = config.lastSentrySeenAt
      ? Date.parse(config.lastSentrySeenAt)
      : null;
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
    const db = getDb();
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      for (const issue of observedIssues) {
        const id = itemDedupeKey(
          { source: "sentry", externalId: issue.id },
          orgId,
        );
        const existing = (
          await tx
            .select()
            .from(triageItems)
            .where(and(eq(triageItems.id, id), eq(triageItems.orgId, orgId)))
            .limit(1)
        )[0];
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
        const updatedAt = sourceChanged
          ? now
          : (existing?.updatedAt ?? now);
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
            },
          });
      }

      await tx
        .update(triageConfig)
        .set({
          lastSentrySeenAt:
            observedIssues.reduce<string | null>((latest, issue) => {
              if (!latest) return issue.firstSeen;
              return Date.parse(issue.firstSeen) > Date.parse(latest)
                ? issue.firstSeen
                : latest;
            }, config.lastSentrySeenAt) ?? config.lastSentrySeenAt,
          updatedAt: now,
        })
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)));
    });

    if (observedIssues.length === 0) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-sentry-errors",
          kind: "observed",
          source: "sentry",
          summary: "No unresolved Sentry errors were observed.",
          details: { sentryOrgSlug: config.sentryOrgSlug },
        },
      );
    } else {
      for (const issue of observedIssues) {
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "poll-sentry-errors",
            kind: "observed",
            itemId: itemDedupeKey(
              { source: "sentry", externalId: issue.id },
              orgId,
            ),
            source: "sentry",
            sourceUrl: issue.permalink,
            summary: issue.title,
            details: {
              shortId: issue.shortId,
              level: issue.level,
              count: issue.count,
              projectSlug: issue.projectSlug,
            },
          },
        );
      }
    }

    return {
      ok: true,
      observed: observedIssues.length,
      fetched: issues.length,
      sentryOrgSlug: config.sentryOrgSlug,
    };
  },
});
