import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageItems } from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { authorMatchesFilter } from "../server/lib/factory-automation-config.js";
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
  closedPullRequestKind,
  closedPullRequestTerminalMetadataPatch,
  pullRequestReopenedFromTerminal,
  reopenedFromTerminalBabysitMetadataPatch,
  terminalItemStatusForClosedPullRequest,
} from "../server/triage/babysit-pr-terminal.js";
import {
  createGitHubClient,
  GitHubRequestError,
  type GitHubIssue,
  type GitHubOpenItemPage,
  type GitHubPullRequest,
  type GitHubPullRequestSummary,
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
  botReviewBodyKeys,
  deferBabysitQuietWindowExpired,
  countHumanReviewBodies,
  countHumanReviewComments,
  detectBotErrorAfterPing,
  hasHumanChangesRequested,
  hasNewBotReviewWork,
  hasNewDefiniteMergeConflict,
  hasNewHumanReviewWork,
  resolveStickyMergeability,
  shouldReopenParkedBabysit,
  type StoredMergeability,
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
export const OPEN_PR_RECHECK_EXTRA_LIMIT = 20;
export const PARKED_PR_RECHECK_CONCURRENCY = 4;
export const OPEN_ITEM_PAGE_SIZE = 50;
export const MAX_OPEN_ITEM_PAGES = 5;

export async function collectOpenItems<T>(
  fetchPage: (page: number) => Promise<GitHubOpenItemPage<T>>,
  authorIdOf: (item: T) => string,
  accepts: (authorId: string) => boolean,
  isAlreadyQueued: (item: T) => boolean,
  newItemBudget: number,
): Promise<{
  items: T[];
  authorFiltered: number;
  unparsed: number;
  pagesFetched: number;
  hasMore: boolean;
}> {
  const items: T[] = [];
  let authorFiltered = 0;
  let unparsed = 0;
  let newItems = 0;
  let pagesFetched = 0;
  let hasMore = false;
  for (let page = 1; page <= MAX_OPEN_ITEM_PAGES; page += 1) {
    const result = await fetchPage(page);
    pagesFetched += 1;
    unparsed += result.unparsed;
    for (const item of result.items) {
      if (!accepts(authorIdOf(item))) {
        authorFiltered += 1;
        continue;
      }
      items.push(item);
      if (!isAlreadyQueued(item)) newItems += 1;
    }
    hasMore = result.hasMore;
    if (!hasMore || newItems >= newItemBudget) break;
  }
  return { items, authorFiltered, unparsed, pagesFetched, hasMore };
}

type ParkedRecheck = {
  humanReviewCommentCount: number;
  humanReviewBodyCount: number;
  botReviewBodyKeys: string[];
  commentsTruncated: boolean;
  reviewsTruncated: boolean;
  changesRequested: boolean;
  botErrorAfterPing: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
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

function storedMergeability(metadata: TriageMetadata): StoredMergeability {
  return {
    mergeConflict: metadataBoolean(metadata, "prBabysitMergeConflict"),
    mergeabilityComputed: metadataBoolean(
      metadata,
      "prBabysitMergeabilityComputed",
    ),
  };
}

export function parkedRecheckEvidencePatch(
  existingMetadata: TriageMetadata,
  recheck: ParkedRecheck,
  options?: { deferHumanReviewCounters?: boolean; checkedAt?: string },
) {
  const mergeability = resolveStickyMergeability(
    storedMergeability(existingMetadata),
    recheck,
  );
  const base = {
    prBabysitMergeConflict: mergeability.mergeConflict,
    prBabysitMergeabilityComputed: mergeability.mergeabilityComputed,
    ...(options?.checkedAt
      ? { prBabysitLastCheckedAt: options.checkedAt }
      : {}),
  };
  if (options?.deferHumanReviewCounters) {
    return base;
  }
  return {
    ...base,
    prBabysitHumanReviewCommentCount: recheck.humanReviewCommentCount,
    prBabysitHumanReviewBodyCount: recheck.humanReviewBodyCount,
    prBabysitBotReviewBodyKeys: recheck.botReviewBodyKeys,
    prBabysitCommentsTruncated: recheck.commentsTruncated,
    prBabysitReviewsTruncated: recheck.reviewsTruncated,
    prBabysitChangesRequested: recheck.changesRequested,
  };
}

function parkedRecheckPollMetadataPatch(
  existingMetadata: TriageMetadata,
  recheck: ParkedRecheck,
  reopenParked: boolean,
  checkedAt: string,
): TriageMetadata {
  return {
    ...parkedRecheckEvidencePatch(existingMetadata, recheck, {
      deferHumanReviewCounters: reopenParked,
      checkedAt,
    }),
    ...(reopenParked
      ? {
          prBabysitState: "queued",
          prBabysitPendingReopen: true,
          prBabysitBuilderActiveUntil: null,
        }
      : {}),
  };
}

function openRecheckPollMetadataPatch(
  existingMetadata: TriageMetadata,
  recheck: ParkedRecheck,
  requeueOpen: boolean,
  checkedAt: string,
): TriageMetadata {
  return {
    ...parkedRecheckEvidencePatch(existingMetadata, recheck, { checkedAt }),
    ...(requeueOpen
      ? {
          prBabysitState: "queued",
          prBabysitPendingReopen: true,
          prBabysitBuilderActiveUntil: null,
        }
      : {}),
  };
}

export function shouldRequeueOpenFromRecheck(
  existingMetadata: TriageMetadata,
  recheck: ParkedRecheck | undefined,
): boolean {
  if (!recheck) return false;
  if (
    babysitLeavesReviewWindow(
      metadataString(existingMetadata, "prBabysitState"),
    )
  ) {
    return false;
  }
  return (
    hasNewBotReviewWork({
      storedBotReviewBodyKeys: readStoredStringArray(
        existingMetadata,
        "prBabysitBotReviewBodyKeys",
      ),
      nextBotReviewBodyKeys: recheck.botReviewBodyKeys,
    }) ||
    hasNewHumanReviewWork({
      storedChangesRequested:
        metadataBoolean(existingMetadata, "prBabysitChangesRequested") === true,
      nextChangesRequested: recheck.changesRequested,
      storedCommentsTruncated:
        metadataBoolean(existingMetadata, "prBabysitCommentsTruncated") ===
        true,
      storedHumanReviewCommentCount: metadataNumber(
        existingMetadata,
        "prBabysitHumanReviewCommentCount",
      ),
      nextHumanReviewCommentCount: recheck.humanReviewCommentCount,
      storedHumanReviewBodyCount: metadataNumber(
        existingMetadata,
        "prBabysitHumanReviewBodyCount",
      ),
      nextHumanReviewBodyCount: recheck.humanReviewBodyCount,
      storedReviewsTruncated:
        metadataBoolean(existingMetadata, "prBabysitReviewsTruncated") === true,
      nextReviewsTruncated: recheck.reviewsTruncated,
    })
  );
}

export function buildPullRequestPollMetadataJson(
  currentMetadataJson: string,
  pullRequest: GitHubPullRequest,
  parkedRecheck: ParkedRecheck | undefined,
  reopenParked: boolean,
  checkedAt: string,
): string {
  const metadata = mergeTriageMetadata(currentMetadataJson, {
    kind: "pull_request",
    author: pullRequest.userLogin,
    authorId: String(pullRequest.userId),
    headRef: pullRequest.headRef,
    baseRef: pullRequest.baseRef,
    draft: pullRequest.draft,
    updatedAt: pullRequest.updatedAt,
  });
  const currentMetadata = parseTriageMetadata(currentMetadataJson);
  if (parkedRecheck) {
    return mergeTriageMetadata(
      metadata,
      parkedRecheckPollMetadataPatch(
        currentMetadata,
        parkedRecheck,
        reopenParked,
        checkedAt,
      ),
    );
  }
  if (reopenParked) {
    return mergeTriageMetadata(metadata, { prBabysitState: "queued" });
  }
  if (
    pullRequestReopenedFromTerminal({
      existingBabysitState: metadataString(currentMetadata, "prBabysitState"),
      nextState: pullRequest.state,
      nextDraft: pullRequest.draft,
    })
  ) {
    return mergeTriageMetadata(
      metadata,
      reopenedFromTerminalBabysitMetadataPatch(),
    );
  }
  return metadata;
}

function readStoredStringArray(
  metadata: TriageMetadata,
  key: string,
): readonly string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function shouldReopenFromRecheck(
  existingMetadata: TriageMetadata,
  recheck: ParkedRecheck | undefined,
  parked: boolean,
  parkedState?: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (deferBabysitQuietWindowExpired(existingMetadata, nowMs)) return true;
  const stored = storedMergeability(existingMetadata);
  return shouldReopenParkedBabysit({
    parked,
    parkedState,
    botErrorAfterPing: recheck?.botErrorAfterPing === true,
    newDefiniteMergeConflict: recheck
      ? hasNewDefiniteMergeConflict({
          storedMergeConflict: stored.mergeConflict,
          storedMergeabilityComputed: stored.mergeabilityComputed,
          mergeable: recheck.mergeable,
          mergeableState: recheck.mergeableState,
        })
      : false,
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
    storedBotReviewBodyKeys: readStoredStringArray(
      existingMetadata,
      "prBabysitBotReviewBodyKeys",
    ),
    nextBotReviewBodyKeys: recheck?.botReviewBodyKeys,
  });
}

function parkedRecheckSortKey(metadataJson: string | null | undefined): string {
  return (
    metadataString(
      parseTriageMetadata(metadataJson ?? "{}"),
      "prBabysitLastCheckedAt",
    ) ?? ""
  );
}

export function selectParkedRowsForRecheck<
  T extends {
    pullRequestNumber: number | null;
    repository: string | null;
    metadataJson?: string | null;
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
    parkedRecheckSortKey(left.metadataJson).localeCompare(
      parkedRecheckSortKey(right.metadataJson),
    ),
  );
  return [...inOpenPage, ...extras.slice(0, extraLimit)];
}

export function selectOpenPrRowsForRecheck<
  T extends {
    pullRequestNumber: number | null;
    repository: string | null;
    metadataJson?: string | null;
  },
>(
  rows: readonly T[],
  input: {
    configuredRepository: string;
    listedOpenPrNumbers: ReadonlySet<number>;
    extraLimit?: number;
  },
): T[] {
  const extraLimit = input.extraLimit ?? OPEN_PR_RECHECK_EXTRA_LIMIT;
  const inOpenPage: T[] = [];
  const extras: T[] = [];
  for (const row of rows) {
    if (typeof row.pullRequestNumber !== "number") continue;
    if (!gitHubRepositoriesEqual(row.repository, input.configuredRepository)) {
      continue;
    }
    const babysitState = metadataString(
      parseTriageMetadata(row.metadataJson ?? "{}"),
      "prBabysitState",
    );
    if (babysitLeavesReviewWindow(babysitState)) continue;
    if (input.listedOpenPrNumbers.has(row.pullRequestNumber)) {
      inOpenPage.push(row);
    } else {
      extras.push(row);
    }
  }
  extras.sort((left, right) =>
    parkedRecheckSortKey(left.metadataJson).localeCompare(
      parkedRecheckSortKey(right.metadataJson),
    ),
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

export function incompleteObservationSummary(causes: {
  authorFiltered: number;
  droppedByInboxLimit: number;
  unparsed: number;
  providerHasMore: boolean;
}): string {
  const reasons: string[] = [];
  if (causes.authorFiltered > 0) {
    reasons.push(
      `${causes.authorFiltered} skipped by the automation's author filter`,
    );
  }
  if (causes.droppedByInboxLimit > 0) {
    reasons.push(`${causes.droppedByInboxLimit} dropped at the inbox limit`);
  }
  if (causes.unparsed > 0) {
    reasons.push(
      `${causes.unparsed} pull request${causes.unparsed === 1 ? "" : "s"} returned by the issues endpoint`,
    );
  }
  if (causes.providerHasMore) {
    reasons.push("more provider pages remain unread");
  }
  if (reasons.length === 0) return "No open GitHub items reached the queue.";
  return `No open GitHub items reached the queue: ${reasons.join("; ")}.`;
}

export default defineAction({
  description:
    "Poll the configured GitHub repository for bounded open issues and pull requests and record them in the Factory queue. Items whose author the calling automation's author filter excludes are counted in authorFiltered and never added to the queue; the poll walks further provider pages, counting only items it does not already have, so neither excluded authors nor an already-ingested backlog can starve matching ones. truncated is true whenever the run saw less than the repository's open set — more provider pages remain, the author filter skipped something, or the inbox limit was reached — so a truncated run is not a complete observation. unparsed counts pull requests returned by the issues endpoint: they are fetched as pull requests instead, so they explain an issue count of zero without meaning work was missed. This does not write to GitHub.",
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
      unparsed: 0,
      pagesFetched: 0,
      hasMore: false,
    });
    const issueItemId = (number: number) =>
      itemDedupeKey(
        { source: "github_issue", externalId: `${repositoryName}#${number}` },
        orgId,
        factoryId,
      );
    const pullRequestItemId = (number: number) =>
      itemDedupeKey(
        {
          source: "github",
          externalId: `${repositoryName}#${number}`,
          repository: repositoryName,
          pullRequestNumber: number,
        },
        orgId,
        factoryId,
      );
    const queuedItemIds = new Set(
      (
        await db
          .select({ id: triageItems.id })
          .from(triageItems)
          .where(orgFactoryItemFilter(orgId, factoryId))
      ).map((row) => row.id),
    );
    const [issueCollection, pullRequestCollection] = await Promise.all([
      includeIssues
        ? collectOpenItems(
            (page) =>
              client.listOpenIssues(repository, OPEN_ITEM_PAGE_SIZE, { page }),
            (issue) => issue.userId,
            acceptsAuthor,
            (issue) => queuedItemIds.has(issueItemId(issue.number)),
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
            (pullRequest) =>
              queuedItemIds.has(pullRequestItemId(pullRequest.number)),
            inboxLimit,
          )
        : Promise.resolve(emptyCollection<GitHubPullRequest>()),
    ]);
    const issues = issueCollection.items;
    const pullRequests = pullRequestCollection.items;
    const authorFiltered =
      issueCollection.authorFiltered + pullRequestCollection.authorFiltered;
    const unparsed = issueCollection.unparsed + pullRequestCollection.unparsed;
    const pagesFetched =
      issueCollection.pagesFetched + pullRequestCollection.pagesFetched;
    const providerHasMore =
      issueCollection.hasMore || pullRequestCollection.hasMore;
    const parkedRechecks = new Map<number, ParkedRecheck>();
    const closedRecheckUpdates = new Map<
      number,
      {
        row: (typeof existingPrs)[number];
        summary: GitHubPullRequestSummary;
      }
    >();
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
    const authorScopedPrs = existingPrs.filter(
      (row) =>
        typeof row.pullRequestNumber === "number" &&
        acceptsAuthor(triageItemAuthorId(row.metadataJson)),
    );
    const parkedRows = authorScopedPrs.filter((row) =>
      babysitLeavesReviewWindow(
        metadataString(parseTriageMetadata(row.metadataJson), "prBabysitState"),
      ),
    );
    const openPrRows = authorScopedPrs.filter(
      (row) =>
        !babysitLeavesReviewWindow(
          metadataString(
            parseTriageMetadata(row.metadataJson),
            "prBabysitState",
          ),
        ),
    );
    const recheckByNumber = new Map<number, (typeof existingPrs)[number]>();
    for (const row of [
      ...selectParkedRowsForRecheck(parkedRows, {
        configuredRepository: repositoryName,
        listedOpenPrNumbers,
      }),
      ...selectOpenPrRowsForRecheck(openPrRows, {
        configuredRepository: repositoryName,
        listedOpenPrNumbers,
      }),
    ]) {
      const number = row.pullRequestNumber;
      if (typeof number === "number" && !recheckByNumber.has(number)) {
        recheckByNumber.set(number, row);
      }
    }
    const recheckRows = [...recheckByNumber.values()];
    await mapWithConcurrency(
      recheckRows,
      PARKED_PR_RECHECK_CONCURRENCY,
      async (row) => {
        const number = row.pullRequestNumber;
        if (typeof number !== "number") return;
        try {
          const summary = await client.getPullRequestSummary(
            repository,
            number,
          );
          const terminalKind = closedPullRequestKind(summary);
          if (terminalKind) {
            closedRecheckUpdates.set(number, { row, summary });
            return;
          }
          const headSha = summary.headSha || row.headSha;
          if (!headSha) return;
          const [evidence, issueComments] = await Promise.all([
            client.getPullRequestEvidence(repository, number, headSha),
            client.listIssueComments(repository, number),
          ]);
          const rowMetadata = parseTriageMetadata(row.metadataJson ?? "{}");
          const lastCommentAt = metadataString(
            rowMetadata,
            "prBabysitLastCommentAt",
          );
          const lastCommentAtMs = lastCommentAt
            ? Date.parse(lastCommentAt)
            : null;
          parkedRechecks.set(number, {
            humanReviewCommentCount: countHumanReviewComments(
              evidence.comments,
            ),
            humanReviewBodyCount: countHumanReviewBodies(evidence.reviews),
            botReviewBodyKeys: botReviewBodyKeys(evidence.comments),
            commentsTruncated: evidence.commentsTruncated,
            reviewsTruncated: evidence.reviewsTruncated,
            changesRequested: hasHumanChangesRequested(evidence.reviews),
            botErrorAfterPing: detectBotErrorAfterPing({
              comments: evidence.comments,
              issueComments: issueComments.comments,
              lastCommentAtMs:
                lastCommentAtMs !== null && Number.isFinite(lastCommentAtMs)
                  ? lastCommentAtMs
                  : null,
            }),
            mergeable: summary.mergeable,
            mergeableState: summary.mergeableState,
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
        const id = issueItemId(issue.number);
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
        const id = pullRequestItemId(pullRequest.number);
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
        const summary = pullRequest.body?.slice(0, 4_000) ?? null;
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
          existingBabysitState,
        );
        const status = statusAfterPullRequestPoll({
          existingStatus: existing?.status,
          existingAuthor: metadataString(existingMetadata, "author"),
          nextAuthor: pullRequest.userLogin,
          existingBabysitState,
          babysitReopened: reopenParked,
          nextState: pullRequest.state,
          nextDraft: pullRequest.draft,
          sourceChanged,
        });
        const lastSeenAt = pullRequest.updatedAt;
        if (!existing) added += 1;
        else updated += 1;
        const requeueOpenInitial =
          existing &&
          !reopenParked &&
          shouldRequeueOpenFromRecheck(existingMetadata, parkedRecheck);
        if (
          !existing ||
          reopenParked ||
          requeueOpenInitial ||
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
        if (existing) {
          const fresh = (
            await tx
              .select()
              .from(triageItems)
              .where(and(eq(triageItems.id, id), eq(triageItems.orgId, orgId)))
              .limit(1)
          )[0];
          if (!fresh) continue;
          const freshMetadata = parseTriageMetadata(fresh.metadataJson);
          const freshBabysitState = metadataString(
            freshMetadata,
            "prBabysitState",
          );
          const reopenParkedFresh = shouldReopenFromRecheck(
            freshMetadata,
            parkedRecheck,
            babysitLeavesReviewWindow(freshBabysitState),
            freshBabysitState,
          );
          const requeueOpenFresh =
            !reopenParkedFresh &&
            shouldRequeueOpenFromRecheck(freshMetadata, parkedRecheck);
          const metadataWithBabysit = requeueOpenFresh
            ? mergeTriageMetadata(
                buildPullRequestPollMetadataJson(
                  fresh.metadataJson,
                  pullRequest,
                  parkedRecheck,
                  false,
                  now,
                ),
                openRecheckPollMetadataPatch(
                  freshMetadata,
                  parkedRecheck as ParkedRecheck,
                  true,
                  now,
                ),
              )
            : buildPullRequestPollMetadataJson(
                fresh.metadataJson,
                pullRequest,
                parkedRecheck,
                reopenParkedFresh,
                now,
              );
          const statusFresh = statusAfterPullRequestPoll({
            existingStatus: fresh.status,
            existingAuthor: metadataString(freshMetadata, "author"),
            nextAuthor: pullRequest.userLogin,
            existingBabysitState: freshBabysitState,
            babysitReopened: reopenParkedFresh,
            nextState: pullRequest.state,
            nextDraft: pullRequest.draft,
            sourceChanged,
          });
          await tx
            .update(triageItems)
            .set({
              sourceUrl: pullRequest.htmlUrl,
              title: pullRequest.title,
              summary,
              status: statusFresh,
              repository: repositoryName,
              pullRequestNumber: pullRequest.number,
              headSha: pullRequest.headSha,
              metadataJson: metadataWithBabysit,
              lastSeenAt,
              updatedAt:
                sourceChanged || reopenParkedFresh || requeueOpenFresh
                  ? now
                  : fresh.updatedAt,
              factoryId,
            })
            .where(
              and(
                eq(triageItems.id, id),
                eq(triageItems.orgId, orgId),
                eq(triageItems.updatedAt, fresh.updatedAt),
              ),
            );
        } else {
          const metadataWithBabysit = buildPullRequestPollMetadataJson(
            "{}",
            pullRequest,
            parkedRecheck,
            reopenParked,
            now,
          );
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
              risk: "unknown",
              repository: repositoryName,
              pullRequestNumber: pullRequest.number,
              headSha: pullRequest.headSha,
              coverage: "partial",
              dedupeKey: id,
              metadataJson: metadataWithBabysit,
              lastSeenAt,
              createdAt: now,
              updatedAt: now,
              ownerEmail: userEmail,
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
                updatedAt: now,
                factoryId,
              },
            });
        }
        pullRequestCount += 1;
      }
      for (const { row, summary } of closedRecheckUpdates.values()) {
        const kind = closedPullRequestKind(summary);
        if (!kind) continue;
        const current = (
          await tx
            .select({
              metadataJson: triageItems.metadataJson,
              updatedAt: triageItems.updatedAt,
            })
            .from(triageItems)
            .where(
              and(eq(triageItems.id, row.id), eq(triageItems.orgId, orgId)),
            )
            .limit(1)
        )[0];
        if (!current) continue;
        await tx
          .update(triageItems)
          .set({
            metadataJson: mergeTriageMetadata(
              current.metadataJson,
              closedPullRequestTerminalMetadataPatch(kind, now, summary),
            ),
            status: terminalItemStatusForClosedPullRequest(kind),
            updatedAt: now,
            lastSeenAt: summary.updatedAt,
            factoryId,
          })
          .where(
            and(
              eq(triageItems.id, row.id),
              eq(triageItems.orgId, orgId),
              eq(triageItems.updatedAt, current.updatedAt),
            ),
          );
        updated += 1;
      }

      for (const row of recheckRows) {
        const number = row.pullRequestNumber;
        if (typeof number !== "number" || listedOpenPrNumbers.has(number))
          continue;
        if (closedRecheckUpdates.has(number)) continue;
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
        const currentBabysitState = metadataString(
          currentMetadata,
          "prBabysitState",
        );
        const parked = babysitLeavesReviewWindow(currentBabysitState);
        const reopenParked = parked
          ? shouldReopenFromRecheck(
              currentMetadata,
              parkedRecheck,
              true,
              currentBabysitState,
            )
          : false;
        const requeueOpen =
          !parked &&
          shouldRequeueOpenFromRecheck(currentMetadata, parkedRecheck);
        const shouldBump = reopenParked || requeueOpen;
        if (!shouldBump) {
          await tx
            .update(triageItems)
            .set({
              metadataJson: mergeTriageMetadata(
                current.metadataJson,
                parkedRecheckEvidencePatch(currentMetadata, parkedRecheck, {
                  checkedAt: now,
                }),
              ),
            })
            .where(
              and(
                eq(triageItems.id, row.id),
                eq(triageItems.orgId, orgId),
                eq(triageItems.updatedAt, current.updatedAt),
              ),
            );
          continue;
        }
        const metadataWithBabysit = mergeTriageMetadata(
          current.metadataJson,
          parked
            ? parkedRecheckPollMetadataPatch(
                currentMetadata,
                parkedRecheck,
                reopenParked,
                now,
              )
            : openRecheckPollMetadataPatch(
                currentMetadata,
                parkedRecheck,
                true,
                now,
              ),
        );
        await tx
          .update(triageItems)
          .set({
            metadataJson: metadataWithBabysit,
            updatedAt: now,
            status: "pr_observed" as const,
          })
          .where(
            and(
              eq(triageItems.id, row.id),
              eq(triageItems.orgId, orgId),
              eq(triageItems.updatedAt, current.updatedAt),
            ),
          );
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

    const truncated =
      providerHasMore || authorFiltered > 0 || droppedByInboxLimit > 0;

    const observationCauses = {
      authorFiltered,
      droppedByInboxLimit,
      unparsed,
      providerHasMore,
    };
    const causeDetails = {
      repository: repositoryName,
      inboxLimit,
      authorFiltered,
      droppedByInboxLimit,
      unparsed,
      pagesFetched,
      providerHasMore,
      truncated,
    };

    if (
      issues.length === 0 &&
      pullRequests.length === 0 &&
      !truncated &&
      unparsed === 0
    ) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-github-sources",
          kind: "observed",
          source: "github",
          summary: "No open GitHub issues or pull requests were observed.",
          details: {
            ...causeDetails,
            added: 0,
            updated: 0,
            newlyObserved: 0,
          },
        },
        factoryId,
      );
    } else if (issueCount + pullRequestCount === 0) {
      await recordFactoryAudit(
        context,
        { userEmail, orgId },
        {
          action: "poll-github-sources",
          kind: "observed",
          status: "skipped",
          source: "github",
          summary: incompleteObservationSummary(observationCauses),
          details: {
            ...causeDetails,
            added: 0,
            updated: 0,
            newlyObserved: 0,
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
            ...causeDetails,
            issues: issueCount,
            pullRequests: pullRequestCount,
            added,
            updated,
            newlyObserved: newlyObserved.filter((item) => item.added).length,
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
      unparsed,
      pagesFetched,
      providerHasMore,
      truncated,
    };
  },
});
