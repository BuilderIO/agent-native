import {
  coverageEntriesForThreads,
  parseInlineDisposition,
  type BabysitThreadDisposition,
} from "./babysit-coverage-comment.js";
import {
  DEFAULT_BABYSIT_BOT_AUTHORS,
  isBabysitBotAuthor,
  type ReviewCommentObservation,
} from "./pr-babysit.js";

export type ThreadClosureStatus =
  | "open"
  | "replied"
  | "resolved"
  | "outdated"
  | "coverage"
  | "disposition-required-fixed"
  | "disposition-optional"
  | "disposition-not-fixing";

export type ThreadDispositionAssessment = {
  rootCommentId: string;
  threadId: string | null;
  status: ThreadClosureStatus;
  disposition: BabysitThreadDisposition | null;
  blocksMergeable: boolean;
  addressedAfterPing: boolean;
};

export type ThreadDispositionAggregate = {
  threads: ThreadDispositionAssessment[];
  mergeableCondition: boolean;
  blockingOpenCount: number;
  dispositionCounts: {
    requiredFixed: number;
    requiredNotFixing: number;
    optionalSkipping: number;
    unrecognizedReply: number;
    open: number;
  };
};

function dispositionBlocksMergeable(
  disposition: BabysitThreadDisposition | null,
): boolean {
  if (!disposition) return false;
  if (disposition === "required-not-fixing") return true;
  return false;
}

function createdAtOrAfterPing(
  createdAt: string,
  lastPingMs: number | null,
): boolean {
  if (lastPingMs === null) return false;
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && createdMs >= lastPingMs;
}

function threadHasPostPingBotReply(
  rootId: string,
  repliesByRoot: ReadonlyMap<string, ReviewCommentObservation[]>,
  lastPingMs: number | null,
  botAuthors: readonly string[],
): boolean {
  for (const reply of repliesByRoot.get(rootId) ?? []) {
    if (!isBabysitBotAuthor(reply.author, botAuthors)) continue;
    if (createdAtOrAfterPing(reply.createdAt, lastPingMs)) return true;
  }
  return false;
}

function statusFromDisposition(
  disposition: BabysitThreadDisposition,
): ThreadClosureStatus {
  switch (disposition) {
    case "required-fixed":
      return "disposition-required-fixed";
    case "required-not-fixing":
      return "disposition-not-fixing";
    case "optional-skipping":
      return "disposition-optional";
    default:
      return "replied";
  }
}

export function assessThreadDispositions(input: {
  comments: readonly ReviewCommentObservation[];
  issueComments?: readonly {
    body: string;
    author: string;
    createdAt: string;
  }[];
  lastCommentAtMs?: number | null;
  botAuthors?: readonly string[];
}): ThreadDispositionAggregate {
  const botAuthors = input.botAuthors ?? [...DEFAULT_BABYSIT_BOT_AUTHORS];
  const lastPingMs = input.lastCommentAtMs ?? null;
  const issueBodies = (input.issueComments ?? [])
    .filter((comment) => {
      if (lastPingMs === null) return true;
      const createdMs = Date.parse(comment.createdAt);
      return Number.isFinite(createdMs) && createdMs >= lastPingMs;
    })
    .filter((comment) => isBabysitBotAuthor(comment.author, botAuthors))
    .map((comment) => comment.body);
  const coverageByRoot = coverageEntriesForThreads(input.comments, issueBodies);
  const repliesByRoot = new Map<string, ReviewCommentObservation[]>();
  for (const comment of input.comments) {
    if (!comment.inReplyToId) continue;
    const bucket = repliesByRoot.get(comment.inReplyToId) ?? [];
    bucket.push(comment);
    repliesByRoot.set(comment.inReplyToId, bucket);
  }

  const threads: ThreadDispositionAssessment[] = [];
  const dispositionCounts = {
    requiredFixed: 0,
    requiredNotFixing: 0,
    optionalSkipping: 0,
    unrecognizedReply: 0,
    open: 0,
  };

  for (const comment of input.comments) {
    if (comment.inReplyToId !== null) continue;
    let status: ThreadClosureStatus = "open";
    let disposition: BabysitThreadDisposition | null = null;
    let addressedAfterPing = false;

    if (comment.isResolved === true) {
      status = "resolved";
      addressedAfterPing = threadHasPostPingBotReply(
        comment.id,
        repliesByRoot,
        lastPingMs,
        botAuthors,
      );
    } else if (comment.isOutdated === true) {
      status = "outdated";
      addressedAfterPing = threadHasPostPingBotReply(
        comment.id,
        repliesByRoot,
        lastPingMs,
        botAuthors,
      );
    } else {
      const coverage = coverageByRoot.get(comment.id);
      if (coverage) {
        status = "coverage";
        disposition = coverage.disposition;
        addressedAfterPing = lastPingMs !== null;
        if (disposition === "unrecognized") {
          dispositionCounts.unrecognizedReply += 1;
        }
      } else {
        for (const reply of repliesByRoot.get(comment.id) ?? []) {
          if (!isBabysitBotAuthor(reply.author, botAuthors)) continue;
          const postPingReply =
            lastPingMs === null ||
            createdAtOrAfterPing(reply.createdAt, lastPingMs);
          if (lastPingMs !== null && !postPingReply) continue;
          const inline = parseInlineDisposition(reply.body);
          if (inline) {
            disposition = inline;
            status = statusFromDisposition(inline);
            if (postPingReply && lastPingMs !== null) {
              addressedAfterPing = true;
            }
            break;
          }
          status = "replied";
          if (postPingReply && lastPingMs !== null) {
            addressedAfterPing = true;
          }
          dispositionCounts.unrecognizedReply += 1;
          break;
        }
      }
    }

    if (status === "open") dispositionCounts.open += 1;
    if (disposition === "required-fixed") dispositionCounts.requiredFixed += 1;
    if (disposition === "required-not-fixing") {
      dispositionCounts.requiredNotFixing += 1;
    }
    if (disposition === "optional-skipping") {
      dispositionCounts.optionalSkipping += 1;
    }

    const blocksMergeable =
      status === "open" ||
      status === "disposition-not-fixing" ||
      dispositionBlocksMergeable(disposition);

    threads.push({
      rootCommentId: comment.id,
      threadId: comment.threadId ?? null,
      status,
      disposition,
      blocksMergeable,
      addressedAfterPing,
    });
  }

  const blockingOpenCount = threads.filter(
    (thread) => thread.blocksMergeable,
  ).length;
  return {
    threads,
    mergeableCondition: blockingOpenCount === 0,
    blockingOpenCount,
    dispositionCounts,
  };
}

export function builderAddressedReviewThreadsAfterPing(
  assessment: ThreadDispositionAggregate | null | undefined,
): boolean {
  if (!assessment) return false;
  return assessment.threads.some((thread) => thread.addressedAfterPing);
}

export function rootCommentsClosedByAssessment(
  comments: readonly ReviewCommentObservation[],
  assessment: ThreadDispositionAggregate,
): readonly ReviewCommentObservation[] {
  const openRoots = new Set(
    assessment.threads
      .filter((thread) => thread.blocksMergeable)
      .map((thread) => thread.rootCommentId),
  );
  return comments.filter(
    (comment) => comment.inReplyToId === null && openRoots.has(comment.id),
  );
}
