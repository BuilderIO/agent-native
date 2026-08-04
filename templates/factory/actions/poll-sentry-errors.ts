import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import { mergeTriageMetadata } from "../server/triage/metadata.js";
import { createSentryClient } from "../server/triage/sentry-client.js";

export default defineAction({
  description:
    "Poll bounded unresolved Sentry issues for the configured organization and record them in the Factory queue. This does not change Sentry.",
  schema: z.object({ limit: z.number().int().min(1).max(50).default(25) }),
  http: false,
  run: async ({ limit }, context) => {
    if (context?.caller !== "automation") {
      throw new Error(
        "Sentry source polling is only available to Factory automations.",
      );
    }
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const config = (
      await getDb()
        .select()
        .from(triageConfig)
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
        .limit(1)
    )[0];
    if (!config?.sentryOrgSlug) {
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
    const newIssues = issues.filter((issue) => {
      const firstSeen = Date.parse(issue.firstSeen);
      if (Number.isNaN(firstSeen))
        throw new Error(
          `Sentry issue ${issue.id} has an invalid firstSeen timestamp.`,
        );
      return cursor === null || firstSeen > cursor;
    });
    const db = getDb();
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      for (const issue of newIssues) {
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
        await tx
          .insert(triageItems)
          .values({
            id,
            source: "sentry",
            externalId: issue.id,
            sourceUrl: issue.permalink,
            title: issue.title,
            summary: [issue.culprit, `${issue.count} events`, issue.level]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 4_000),
            status: existing?.status ?? "received",
            risk: existing?.risk ?? "unknown",
            coverage: existing?.coverage ?? "complete",
            dedupeKey: id,
            metadataJson: metadata,
            lastSeenAt: issue.lastSeen,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            ownerEmail: existing?.ownerEmail ?? userEmail,
            orgId,
          })
          .onConflictDoUpdate({
            target: triageItems.id,
            set: {
              sourceUrl: issue.permalink,
              title: issue.title,
              summary: [issue.culprit, `${issue.count} events`, issue.level]
                .filter(Boolean)
                .join(" · ")
                .slice(0, 4_000),
              metadataJson: metadata,
              lastSeenAt: issue.lastSeen,
              updatedAt: now,
            },
          });
      }

      await tx
        .update(triageConfig)
        .set({
          lastSentrySeenAt:
            newIssues.reduce<string | null>((latest, issue) => {
              if (!latest) return issue.firstSeen;
              return Date.parse(issue.firstSeen) > Date.parse(latest)
                ? issue.firstSeen
                : latest;
            }, config.lastSentrySeenAt) ?? config.lastSentrySeenAt,
          updatedAt: now,
        })
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)));
    });

    return {
      ok: true,
      observed: newIssues.length,
      fetched: issues.length,
      sentryOrgSlug: config.sentryOrgSlug,
    };
  },
});
