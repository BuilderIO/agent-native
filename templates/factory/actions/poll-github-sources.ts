import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { authorMatchesFilter } from "../server/lib/factory-automation-config.js";
import { repairFactoryAutomationsFromConfig } from "../server/lib/factory-automation-repair.js";
import { factoryRepositoryFromSources } from "../server/lib/factory-repository-scope.js";
import {
  factoryIdSchema,
  orgFactoryItemFilter,
  readTriageConfigRow,
  requireExistingFactory,
} from "../server/lib/factory-scope.js";
import {
  gitHubRepositoriesEqual,
  parseGitHubRepositoryRef,
} from "../server/lib/github-repository.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import {
  createGitHubClient,
  GitHubRequestError,
  type GitHubIssue,
  type GitHubOpenItemPage,
  type GitHubPullRequest,
} from "../server/triage/github-client.js";
import { itemDedupeKey } from "../server/triage/ids.js";
import {
  mergeTriageMetadata,
  metadataBoolean,
  metadataNumber,
  metadataString,
  parseTriageMetadata,
  triageItemAuthorId,
  type TriageMetadata,
} from "../server/triage/metadata.js";
import {
  babysitLeavesReviewWindow,
  countHumanReviewBodies,
  countHumanReviewComments,
  hasHumanChangesRequested,
  hasMergeConflict,
  shouldReopenParkedBabysit,
} from "../server/triage/pr-babysit.js";
import {
  hasTriageSourceChanged,
  statusAfterPullRequestPoll,
  statusAfterTriageSourceUpdate,
} from "../server/triage/review-state.js";

type NewlyObservedSource = {
  itemId: string;
  source: "github" | "github_issue";
  sourceUrl: string;
  summary: string;
  number: number;
  added: boolean;
};

export const PARKED_PR_RECHECK_EXTRA_LIMIT = 20;
export const PARKED_PR_RECHECK_CONCURRENCY = 4;
export const OPEN_ITEM_PAGE_SIZE = 50;
export const MAX_OPEN_ITEM_PAGES = 5;

/**
 * Walk provider pages applying the author filter as we go, so excluded authors
 * cannot occupy the budget and starve matching items sitting on a later page.
 * Stops at the budget or the page cap and reports whichever it hit: a run that
 * stopped early is not a run that saw the whole repository.
 */
export async function collectOpenItems<T>(
  fetchPage: (page: number) => Promise<GitHubOpenItemPage<T>>,
  authorIdOf: (item: T) => string,
  accepts: (authorId: string) => boolean,
  budget: number,
): Promise<{ items: T[]; authorFiltered: number; hasMore: boolean }> {
  const items: T[] = [];
  let authorFiltered = 0;
  let hasMore = false;
  for (let page = 1; page <= MAX_OPEN_ITEM_PAGES; page += 1) {
    const result = await fetchPage(page);
    for (const item of result.items) {
      if (!accepts(authorIdOf(item))) {
        authorFiltered += 1;
        continue;
      }
      items.push(item);
    }
    hasMore = result.hasMore;
    if (!hasMore || items.length >= budget) break;
  }
  return { items, authorFiltered, hasMore };
}

type ParkedRecheck = {
  humanReviewCommentCount: number;
  humanReviewBodyCount: number;
  commentsTruncated: boolean;
  reviewsTruncated: boolean;
  changesRequested: boolean;
  mergeConflict: boolean;
};

export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const current = next;
        next += 1;
        await worker(items[current] as T);
      }
    }),
  );
}

function parkedRecheckEvidencePatch(recheck: ParkedRecheck) {
  return {
    prBabysitHumanReviewCommentCount: recheck.humanReviewCommentCount,
    prBabysitHumanReviewBodyCount: recheck.humanReviewBodyCount,
    prBabysitCommentsTruncated: recheck.commentsTruncated,
    prBabysitReviewsTruncated: recheck.reviewsTruncated,
    prBabysitChangesRequested: recheck.changesRequested,
    prBabysitMergeConflict: recheck.mergeConflict,
  };
}

function shouldReopenFromRecheck(
  existingMetadata: TriageMetadata,
  recheck: ParkedRecheck | undefined,
  parked: boolean,
): boolean {
  return shouldReopenParkedBabysit({
    parked,
    storedMergeConflict:
      metadataBoolean(existingMetadata, "prBabysitMergeConflict") === true,
    nextMergeConflict: recheck?.mergeConflict === true,
    storedChangesRequested:
      metadataBoolean(existingMetadata, "prBabysitChangesRequested") === true,
    nextChangesRequested: recheck?.changesRequested === true,
    storedCommentsTruncated:
      metadataBoolean(existingMetadata, "prBabysitCommentsTruncated") === true,
    storedHumanReviewCommentCount: metadataNumber(
      existingMetadata,
      "prBabysitHumanReviewCommentCount",
    ),
    nextHumanReviewCommentCount: recheck?.humanReviewCommentCount,
    storedHumanReviewBodyCount: metadataNumber(
      existingMetadata,
      "prBabysitHumanReviewBodyCount",
    ),
    nextHumanReviewBodyCount: recheck?.humanReviewBodyCount,
    storedReviewsTruncated:
      metadataBoolean(existingMetadata, "prBabysitReviewsTruncated") === true,
    nextReviewsTruncated: recheck?.reviewsTruncated === true,
  });
}

export function selectParkedRowsForRecheck<
  T extends {
    pullRequestNumber: number | null;
    repository: string | null;
    updatedAt?: string | null;
  },
>(
  rows: readonly T[],
  input: {
    configuredRepository: string;
    listedOpenPrNumbers: ReadonlySet<number>;
    extraLimit?: number;
  },
): T[] {
  const extraLimit = input.extraLimit ?? PARKED_PR_RECHECK_EXTRA_LIMIT;
  const inOpenPage: T[] = [];
  const extras: T[] = [];
  for (const row of rows) {
    if (typeof row.pullRequestNumber !== "number") continue;
    if (!gitHubRepositoriesEqual(row.repository, input.configuredRepository)) {
      continue;
    }
    if (input.listedOpenPrNumbers.has(row.pullRequestNumber)) {
      inOpenPage.push(row);
    } else {
      extras.push(row);
    }
  }
  extras.sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
  );
  return [...inOpenPage, ...extras.slice(0, extraLimit)];
}

function isAbsentParkedPullRequest(error: unknown): boolean {
  return error instanceof GitHubRequestError && error.status === 404;
}

function githubPollRollupSummary(
  issueCount: number,
  pullRequestCount: number,
): string {
  const parts: string[] = [];
  if (issueCount > 0) {
    parts.push(`${issueCount} open issue${issueCount === 1 ? "" : "s"}`);
  }
  if (pullRequestCount > 0) {
    parts.push(
      `${pullRequestCount} open pull request${pullRequestCount === 1 ? "" : "s"}`,
    );
  }
  return `Polled ${parts.join(" and ")}.`;
}

export default defineAction({
  description:
    "Poll the configured GitHub repository for bounded open issues and pull requests and record them in the Factory queue. Items whose author the calling automation's author filter excludes are counted in authorFiltered and never added to the queue; the poll walks further provider pages so excluded authors cannot starve matching ones. truncated is true whenever the run saw less than the repository's open set — more provider pages remain, the author filter skipped something, or the inbox limit was reached — so a truncated run is not a complete observation. This does not write to GitHub.",
  schema: z.object({
    factoryId: factoryIdSchema,
    includeIssues: z.boolean().default(true),
    includePullRequests: z.boolean().default(true),
  }),
  http: false,
  run: async ({ factoryId, includeIssues, includePullRequests }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "githubPolling",
      factoryId,
    );
    const db = getDb();
    const config = await readTriageConfigRow(db, orgId, factoryId);
    await repairFactoryAutomationsFromConfig(userEmail, orgId, factoryId);
    const job = await readCallingFactoryAutomation(context, {
      userEmail,
      orgId,
    });
    const repositoryRef = factoryRepositoryFromSources(
      job?.config.repository,
      config?.repository,
    );
    if (!repositoryRef) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-github-sources",
          kind: "observed",
          status: "error",
          source: "github",
          summary:
            "No GitHub repository is configured on this factory or its automation.",
        },
        factoryId,
      );
      throw new Error("Configure a GitHub repository before polling GitHub.");
    }
    const inboxLimit = job?.config.inboxLimit ?? 25;

    const repository = parseGitHubRepositoryRef(repositoryRef);
    const repositoryName = `${repository.owner}/${repository.repo}`;
    const client = createGitHubClient({ ownerEmail: userEmail, orgId });
    // One author decision for the whole run: the page walk, the parked-PR
    // recheck, and the reopen path must not disagree about who is in scope.
    const acceptsAuthor = (authorId: string): boolean =>
      !job ||
      authorMatchesFilter(
        authorId,
        job.config.authorMode,
        job.config.authorIds,
      );
    const emptyCollection = <T>() => ({
      items: [] as T[],
      authorFiltered: 0,
      hasMore: false,
    });
    const [issueCollection, pullRequestCollection] = await Promise.all([
      includeIssues
        ? collectOpenItems(
            (page) =>
              client.listOpenIssues(repository, OPEN_ITEM_PAGE_SIZE, { page }),
            (issue) => issue.userId,
            acceptsAuthor,
            inboxLimit,
          )
        : Promise.resolve(emptyCollection<GitHubIssue>()),
      includePullRequests
        ? collectOpenItems(
            (page) =>
              client.listOpenPullRequests(repository, OPEN_ITEM_PAGE_SIZE, {
                page,
              }),
            (pullRequest) => String(pullRequest.userId),
            acceptsAuthor,
            inboxLimit,
          )
        : Promise.resolve(emptyCollection<GitHubPullRequest>()),
    ]);
    const issues = issueCollection.items;
    const pullRequests = pullRequestCollection.items;
    const authorFiltered =
      issueCollection.authorFiltered + pullRequestCollection.authorFiltered;
    const providerHasMore =
      issueCollection.hasMore || pullRequestCollection.hasMore;
    const parkedRechecks = new Map<number, ParkedRecheck>();
    const listedOpenPrNumbers = new Set(
      pullRequests.map((pullRequest) => pullRequest.number),
    );
    const existingPrs = includePullRequests
      ? await db
          .select({
            id: triageItems.id,
            metadataJson: triageItems.metadataJson,
            pullRequestNumber: triageItems.pullRequestNumber,
            headSha: triageItems.headSha,
            sourceUrl: triageItems.sourceUrl,
            title: triageItems.title,
            repository: triageItems.repository,
            updatedAt: triageItems.updatedAt,
          })
          .from(triageItems)
          .where(
            and(
              orgFactoryItemFilter(orgId, factoryId),
              eq(triageItems.source, "github"),
            ),
          )
      : [];
    const parkedRows = existingPrs.filter(
      (row) =>
        typeof row.pullRequestNumber === "number" &&
        acceptsAuthor(triageItemAuthorId(row.metadataJson)) &&
        babysitLeavesReviewWindow(
          metadataString(
            parseTriageMetadata(row.metadataJson),
            "prBabysitState",
          ),
        ),
    );
    const parkedRecheckRows = selectParkedRowsForRecheck(parkedRows, {
      configuredRepository: repositoryName,
      listedOpenPrNumbers,
    });
    await mapWithConcurrency(
      parkedRecheckRows,
      PARKED_PR_RECHECK_CONCURRENCY,
      async (row) => {
        const number = row.pullRequestNumber;
        if (typeof number !== "number") return;
        try {
          const summary = await client.getPullRequestSummary(
            repository,
            number,
          );
          if (summary.state !== "open") return;
          const headSha = summary.headSha || row.headSha;
          if (!headSha) return;
          const evidence = await client.getPullRequestEvidence(
            repository,
            number,
            headSha,
          );
          parkedRechecks.set(number, {
            humanReviewCommentCount: countHumanReviewComments(
              evidence.comments,
            ),
            humanReviewBodyCount: countHumanReviewBodies(evidence.reviews),
            commentsTruncated: evidence.commentsTruncated,
            reviewsTruncated: evidence.reviewsTruncated,
            changesRequested: hasHumanChangesRequested(evidence.reviews),
            mergeConflict: hasMergeConflict({
              mergeable: summary.mergeable,
              mergeableState: summary.mergeableState,
            }),
          });
        } catch (error) {
          if (isAbsentParkedPullRequest(error)) return;
          throw error;
        }
      },
    );
    const now = new Date().toISOString();
    let issueCount = 0;
    let pullRequestCount = 0;
    let added = 0;
    let updated = 0;
    let droppedByInboxLimit = 0;
    const newlyObserved: NewlyObservedSource[] = [];

    await db.transaction(async (tx) => {
      for (const issue of issues) {
        const id = itemDedupeKey(
          {
            source: "github_issue",
            externalId: `${repositoryName}#${issue.number}`,
          },
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
        if (!existing && added >= inboxLimit) {
          droppedByInboxLimit += 1;
          continue;
        }
        const metadata = mergeTriageMetadata(existing?.metadataJson ?? "{}", {
          kind: "github_issue",
          author: issue.userLogin,
          authorId: issue.userId,
          labels: [...issue.labels],
          errorReport: [issue.title, issue.body ?? ""]
            .filter(Boolean)
            .join("\n\n"),
          updatedAt: issue.updatedAt,
        });
        const summary = issue.body?.slice(0, 4_000) ?? null;
        const sourceChanged = hasTriageSourceChanged(existing, {
          sourceUrl: issue.htmlUrl,
          title: issue.title,
          summary,
          lastSeenAt: issue.updatedAt,
        });
        const status = statusAfterTriageSourceUpdate(
          existing?.status,
          sourceChanged,
          "received",
        );
        const updatedAt = sourceChanged ? now : (existing?.updatedAt ?? now);
        const lastSeenAt = sourceChanged
          ? issue.updatedAt
          : (existing?.lastSeenAt ?? issue.updatedAt);
        if (!existing) added += 1;
        else updated += 1;
        if (!existing || sourceChanged) {
          newlyObserved.push({
            itemId: id,
            source: "github_issue",
            sourceUrl: issue.htmlUrl,
            summary: issue.title,
            number: issue.number,
            added: !existing,
          });
        }
        await tx
          .insert(triageItems)
          .values({
            id,
            source: "github_issue",
            externalId: `${repositoryName}#${issue.number}`,
            sourceUrl: issue.htmlUrl,
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
              sourceUrl: issue.htmlUrl,
              title: issue.title,
              summary,
              status,
              metadataJson: metadata,
              lastSeenAt,
              updatedAt,
              factoryId,
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
          },
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
        if (!existing && added >= inboxLimit) {
          droppedByInboxLimit += 1;
          continue;
        }
        const metadata = mergeTriageMetadata(existing?.metadataJson ?? "{}", {
          kind: "pull_request",
          author: pullRequest.userLogin,
          authorId: String(pullRequest.userId),
          headRef: pullRequest.headRef,
          baseRef: pullRequest.baseRef,
          draft: pullRequest.draft,
          updatedAt: pullRequest.updatedAt,
        });
        const summary = pullRequest.body?.slice(0, 4_000) ?? null;
        // GitHub updatedAt moves on CI and comments; head SHA is the review signal.
        const sourceChanged = hasTriageSourceChanged(existing, {
          sourceUrl: pullRequest.htmlUrl,
          title: pullRequest.title,
          summary,
          headSha: pullRequest.headSha,
        });
        const existingMetadata = existing
          ? parseTriageMetadata(existing.metadataJson)
          : {};
        const existingBabysitState = metadataString(
          existingMetadata,
          "prBabysitState",
        );
        const parkedRecheck = parkedRechecks.get(pullRequest.number);
        const reopenParked = shouldReopenFromRecheck(
          existingMetadata,
          parkedRecheck,
          babysitLeavesReviewWindow(existingBabysitState),
        );
        const metadataWithBabysit = parkedRecheck
          ? mergeTriageMetadata(metadata, {
              ...parkedRecheckEvidencePatch(parkedRecheck),
              ...(reopenParked ? { prBabysitState: "queued" } : {}),
            })
          : reopenParked
            ? mergeTriageMetadata(metadata, { prBabysitState: "queued" })
            : metadata;
        const status = statusAfterPullRequestPoll({
          existingStatus: existing?.status,
          existingAuthor: metadataString(existingMetadata, "author"),
          nextAuthor: pullRequest.userLogin,
          existingBabysitState: reopenParked ? "queued" : existingBabysitState,
          nextDraft: pullRequest.draft,
          sourceChanged,
        });
        const updatedAt =
          sourceChanged || reopenParked ? now : (existing?.updatedAt ?? now);
        const lastSeenAt = pullRequest.updatedAt;
        if (!existing) added += 1;
        else updated += 1;
        if (
          !existing ||
          reopenParked ||
          (sourceChanged && status === "pr_observed")
        ) {
          newlyObserved.push({
            itemId: id,
            source: "github",
            sourceUrl: pullRequest.htmlUrl,
            summary: pullRequest.title,
            number: pullRequest.number,
            added: !existing,
          });
        }
        await tx
          .insert(triageItems)
          .values({
            id,
            source: "github",
            externalId: `${repositoryName}#${pullRequest.number}`,
            sourceUrl: pullRequest.htmlUrl,
            title: pullRequest.title,
            summary,
            status,
            risk: existing?.risk ?? "unknown",
            repository: repositoryName,
            pullRequestNumber: pullRequest.number,
            headSha: pullRequest.headSha,
            coverage: existing?.coverage ?? "partial",
            dedupeKey: id,
            metadataJson: metadataWithBabysit,
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
              sourceUrl: pullRequest.htmlUrl,
              title: pullRequest.title,
              summary,
              status,
              repository: repositoryName,
              pullRequestNumber: pullRequest.number,
              headSha: pullRequest.headSha,
              metadataJson: metadataWithBabysit,
              lastSeenAt,
              updatedAt,
              factoryId,
            },
          });
        pullRequestCount += 1;
      }
      for (const row of parkedRows) {
        const number = row.pullRequestNumber;
        if (typeof number !== "number" || listedOpenPrNumbers.has(number))
          continue;
        const parkedRecheck = parkedRechecks.get(number);
        if (!parkedRecheck) continue;
        const current = (
          await tx
            .select({
              metadataJson: triageItems.metadataJson,
              updatedAt: triageItems.updatedAt,
              sourceUrl: triageItems.sourceUrl,
              title: triageItems.title,
            })
            .from(triageItems)
            .where(
              and(eq(triageItems.id, row.id), eq(triageItems.orgId, orgId)),
            )
            .limit(1)
        )[0];
        if (!current) continue;
        const currentMetadata = parseTriageMetadata(current.metadataJson);
        const stillParked = babysitLeavesReviewWindow(
          metadataString(currentMetadata, "prBabysitState"),
        );
        if (!stillParked) continue;
        const reopenParked = shouldReopenFromRecheck(
          currentMetadata,
          parkedRecheck,
          true,
        );
        const metadataWithBabysit = mergeTriageMetadata(current.metadataJson, {
          ...parkedRecheckEvidencePatch(parkedRecheck),
          ...(reopenParked ? { prBabysitState: "queued" } : {}),
        });
        await tx
          .update(triageItems)
          .set({
            metadataJson: metadataWithBabysit,
            ...(reopenParked
              ? { updatedAt: now, status: "pr_observed" as const }
              : {}),
          })
          .where(
            and(
              eq(triageItems.id, row.id),
              eq(triageItems.orgId, orgId),
              eq(triageItems.updatedAt, current.updatedAt),
            ),
          );
        if (!reopenParked) continue;
        updated += 1;
        newlyObserved.push({
          itemId: row.id,
          source: "github",
          sourceUrl: current.sourceUrl ?? row.sourceUrl ?? "",
          summary: current.title ?? row.title ?? `PR #${number}`,
          number,
          added: false,
        });
      }
      await requireExistingFactory(
        tx as unknown as ReturnType<typeof getDb>,
        orgId,
        factoryId,
      );
    });

    // Any of these means the run saw less than the repository's open set, so
    // none of the branches below may report a complete observation.
    const truncated =
      providerHasMore || authorFiltered > 0 || droppedByInboxLimit > 0;

    if (issues.length === 0 && pullRequests.length === 0 && !truncated) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-github-sources",
          kind: "observed",
          source: "github",
          summary: "No open GitHub issues or pull requests were observed.",
          details: {
            repository: repositoryName,
            inboxLimit,
            added: 0,
            updated: 0,
            authorFiltered: 0,
            newlyObserved: 0,
            truncated: false,
          },
        },
        factoryId,
      );
    } else if (issueCount + pullRequestCount === 0) {
      // Open items existed but none belong to this automation's authors; that
      // is not the same state as an empty repository queue.
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-github-sources",
          kind: "observed",
          status: "skipped",
          source: "github",
          summary: `Every open item was skipped by the automation's author filter (${authorFiltered} skipped).`,
          details: {
            repository: repositoryName,
            inboxLimit,
            added: 0,
            updated: 0,
            authorFiltered,
            newlyObserved: 0,
            providerHasMore,
            truncated,
          },
        },
        factoryId,
      );
    } else {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-github-sources",
          kind: "observed",
          source: "github",
          summary: githubPollRollupSummary(issueCount, pullRequestCount),
          details: {
            repository: repositoryName,
            issues: issueCount,
            pullRequests: pullRequestCount,
            inboxLimit,
            added,
            updated,
            authorFiltered,
            droppedByInboxLimit,
            newlyObserved: newlyObserved.filter((item) => item.added).length,
            providerHasMore,
            truncated,
            itemIds: newlyObserved
              .filter((item) => item.added)
              .map((item) => item.itemId),
          },
        },
        factoryId,
      );
      for (const item of newlyObserved) {
        await recordFactoryAudit(
          context,
          { userEmail, orgId },
          {
            action: "poll-github-sources",
            kind: "observed",
            itemId: item.itemId,
            source: item.source,
            sourceUrl: item.sourceUrl,
            summary: item.summary,
            details: {
              repository: repositoryName,
              number: item.number,
              added: item.added,
            },
          },
          factoryId,
        );
      }
    }

    return {
      ok: true,
      factoryId,
      repository: repositoryName,
      issues: issueCount,
      pullRequests: pullRequestCount,
      authorFiltered,
      droppedByInboxLimit,
      providerHasMore,
      truncated,
    };
  },
});
