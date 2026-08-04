import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import { mergeTriageMetadata } from "../server/triage/metadata.js";

function parseRepository(value: string): { owner: string; repo: string } {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value.trim());
  if (!match) {
    throw new Error("Factory repository must use the owner/repository format.");
  }
  return { owner: match[1], repo: match[2] };
}

function requireAutomationCaller(caller: string | undefined): void {
  if (caller !== "automation") {
    throw new Error(
      "GitHub source polling is only available to Factory automations.",
    );
  }
}

export default defineAction({
  description:
    "Poll the configured GitHub repository for bounded open issues and pull requests and record them in the Factory queue. This does not write to GitHub.",
  schema: z.object({
    includeIssues: z.boolean().default(true),
    includePullRequests: z.boolean().default(true),
  }),
  http: false,
  run: async ({ includeIssues, includePullRequests }, context) => {
    requireAutomationCaller(context?.caller);
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
    if (!config?.repository) {
      throw new Error("Configure a GitHub repository before polling GitHub.");
    }

    const repositoryName = config.repository;
    const repository = parseRepository(repositoryName);
    const client = createGitHubClient({ ownerEmail: userEmail, orgId });
    const [issues, pullRequests] = await Promise.all([
      includeIssues
        ? client.listOpenIssues(repository, 50)
        : Promise.resolve([]),
      includePullRequests
        ? client.listOpenPullRequests(repository, 50)
        : Promise.resolve([]),
    ]);
    const db = getDb();
    const now = new Date().toISOString();
    let issueCount = 0;
    let pullRequestCount = 0;

    await db.transaction(async (tx) => {
      for (const issue of issues) {
        const id = itemDedupeKey(
          {
            source: "github_issue",
            externalId: `${repositoryName}#${issue.number}`,
          },
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
          kind: "github_issue",
          author: issue.userLogin,
          labels: [...issue.labels],
          errorReport: [issue.title, issue.body ?? ""]
            .filter(Boolean)
            .join("\n\n"),
          updatedAt: issue.updatedAt,
        });
        await tx
          .insert(triageItems)
          .values({
            id,
            source: "github_issue",
            externalId: `${repositoryName}#${issue.number}`,
            sourceUrl: issue.htmlUrl,
            title: issue.title,
            summary: issue.body?.slice(0, 4_000) ?? null,
            status: existing?.status ?? "received",
            risk: existing?.risk ?? "unknown",
            coverage: existing?.coverage ?? "complete",
            dedupeKey: id,
            metadataJson: metadata,
            lastSeenAt: issue.updatedAt,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            ownerEmail: existing?.ownerEmail ?? userEmail,
            orgId,
          })
          .onConflictDoUpdate({
            target: triageItems.id,
            set: {
              sourceUrl: issue.htmlUrl,
              title: issue.title,
              summary: issue.body?.slice(0, 4_000) ?? null,
              metadataJson: metadata,
              lastSeenAt: issue.updatedAt,
              updatedAt: now,
            },
          });
        issueCount += 1;
      }

      for (const pullRequest of pullRequests) {
        const id = itemDedupeKey(
          {
            source: "github",
            externalId: `${repositoryName}#${pullRequest.number}`,
            repository: repositoryName,
            pullRequestNumber: pullRequest.number,
            headSha: pullRequest.headSha,
          },
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
          kind: "pull_request",
          author: pullRequest.userLogin,
          headRef: pullRequest.headRef,
          baseRef: pullRequest.baseRef,
          draft: pullRequest.draft,
          updatedAt: pullRequest.updatedAt,
        });
        await tx
          .insert(triageItems)
          .values({
            id,
            source: "github",
            externalId: `${repositoryName}#${pullRequest.number}`,
            sourceUrl: pullRequest.htmlUrl,
            title: pullRequest.title,
            summary: pullRequest.body?.slice(0, 4_000) ?? null,
            status: existing?.status ?? "pr_observed",
            risk: existing?.risk ?? "unknown",
            repository: repositoryName,
            pullRequestNumber: pullRequest.number,
            headSha: pullRequest.headSha,
            coverage: existing?.coverage ?? "partial",
            dedupeKey: id,
            metadataJson: metadata,
            lastSeenAt: pullRequest.updatedAt,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            ownerEmail: existing?.ownerEmail ?? userEmail,
            orgId,
          })
          .onConflictDoUpdate({
            target: triageItems.id,
            set: {
              sourceUrl: pullRequest.htmlUrl,
              title: pullRequest.title,
              summary: pullRequest.body?.slice(0, 4_000) ?? null,
              repository: repositoryName,
              pullRequestNumber: pullRequest.number,
              headSha: pullRequest.headSha,
              metadataJson: metadata,
              lastSeenAt: pullRequest.updatedAt,
              updatedAt: now,
            },
          });
        pullRequestCount += 1;
      }
    });

    return {
      ok: true,
      repository: repositoryName,
      issues: issueCount,
      pullRequests: pullRequestCount,
    };
  },
});
