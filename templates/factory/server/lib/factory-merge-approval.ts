import type { PullRequestReviewObservation } from "../triage/pr-monitor.js";
import { isBuilderLogin } from "./factory-pull-request.js";

/**
 * GitHub's own rule for a review that counts toward a required approval: the
 * reviewer has write access. `author_association` is the closest thing a review
 * carries to that, so only these three count.
 */
const APPROVER_ASSOCIATIONS: ReadonlySet<string> = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);

/**
 * What the approval rule counted, as numbers only. Every approval seen lands
 * in exactly one of the five buckets below, so `seen` is their sum; an
 * approval that fits several is counted under the first that applies, in the
 * order they are listed.
 */
export interface ApprovalCounts {
  /** Reviewers whose latest review that is not a comment is an approval. */
  seen: number;
  /** A person who is an owner, member or collaborator other than the author, on the current head commit. */
  qualifying: number;
  /** Given by the pull request's own author. */
  byAuthor: number;
  /** Given by a bot or a Builder account: the merge wants a person's review. */
  fromBots: number;
  /** Given by someone GitHub does not list as an owner, member or collaborator. */
  fromNonCollaborators: number;
  /** Given on an earlier commit than the current head. */
  stale: number;
}

type ReviewLike = Pick<
  PullRequestReviewObservation,
  | "author"
  | "state"
  | "commitSha"
  | "authorAssociation"
  | "authorType"
  | "observedAt"
>;

/** A GitHub app (a `[bot]` login or a `Bot` user type) or one of Builder's own accounts. */
function isAutomationAccount(review: ReviewLike): boolean {
  return (
    review.author.toLowerCase().endsWith("[bot]") ||
    review.authorType?.toLowerCase() === "bot" ||
    isBuilderLogin(review.author)
  );
}

/**
 * Counts the approvals a pull request has right now. A reviewer's standing is
 * their latest review that is not a comment: a later request for changes or a
 * dismissal cancels an approval, while a comment (or a draft review, which has
 * not been submitted) does not. The reviews are read oldest first; ties in time
 * keep the order given.
 */
export function countApprovals(
  reviews: readonly ReviewLike[],
  pullRequest: { headSha: string; authorLogin: string },
): ApprovalCounts {
  const standing = new Map<string, ReviewLike>();
  reviews
    .map((review, order) => ({ review, order }))
    .sort(
      (left, right) =>
        Date.parse(left.review.observedAt) -
          Date.parse(right.review.observedAt) || left.order - right.order,
    )
    .forEach(({ review }) => {
      if (
        review.state === "approved" ||
        review.state === "changes_requested" ||
        review.state === "dismissed"
      ) {
        standing.set(review.author.toLowerCase(), review);
      }
    });

  const counts: ApprovalCounts = {
    seen: 0,
    qualifying: 0,
    byAuthor: 0,
    fromBots: 0,
    fromNonCollaborators: 0,
    stale: 0,
  };
  const author = pullRequest.authorLogin.toLowerCase();
  for (const [reviewer, review] of standing) {
    if (review.state !== "approved") continue;
    counts.seen += 1;
    if (reviewer === author) counts.byAuthor += 1;
    else if (isAutomationAccount(review)) counts.fromBots += 1;
    else if (
      !APPROVER_ASSOCIATIONS.has(review.authorAssociation?.toUpperCase() ?? "")
    )
      counts.fromNonCollaborators += 1;
    else if (review.commitSha !== pullRequest.headSha) counts.stale += 1;
    else counts.qualifying += 1;
  }
  return counts;
}

const plural = (count: number) => `${count} approval${count === 1 ? "" : "s"}`;

/** Why no approval counts, in words a person can act on. Built from the counts alone. */
export function approvalRequiredMessage(counts: ApprovalCounts): string {
  const base =
    "No owner, member or collaborator other than the author has approved the current head commit.";
  const found = [
    counts.stale > 0 && `${plural(counts.stale)} on an earlier commit`,
    counts.fromBots > 0 &&
      `${plural(counts.fromBots)} from a bot or Builder account`,
    counts.fromNonCollaborators > 0 &&
      `${plural(counts.fromNonCollaborators)} from someone who is not an owner, member or collaborator`,
    counts.byAuthor > 0 &&
      `${plural(counts.byAuthor)} from the pull request's own author`,
  ].filter((part): part is string => part !== false);
  return found.length > 0
    ? `${base} Approvals found that do not count: ${found.join(", ")}.`
    : base;
}
