import { fail, type ActionRunContext } from "@agent-native/core/action";
import {
  LiveCopyError,
  loadYDocVersion,
  mutateLiveCopy,
  type LiveCopyBinding,
} from "@agent-native/core/collab";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import {
  getSuggestion,
  type ResourceSuggestion,
  type SuggestionDecisionContext,
  type SuggestionDecisionRunOptions,
} from "@agent-native/core/review";
import { prepareTransactionalChange } from "@agent-native/core/server";

import {
  markdownPayload,
  operationAnchor,
  type MarkdownRange,
} from "../../shared/suggestion-apply.js";
import {
  APPLY_SUGGESTION_EDIT,
  APPLY_SUGGESTION_REFUSALS,
  type ApplySuggestionInput,
  type ApplySuggestionRefusalReason,
  type ApplySuggestionStep,
} from "../live-copy/apply-suggestion-edit.js";

// On a Page whose body is its live copy, accepting is one live-copy edit that
// places exactly the accepted suggestions, and the decision commits in that
// edit's transaction. A decision never commits without its edit, nor the
// edit without its decision.

/** What the Page's body persist wrote in one commit attempt. */
export type LiveCopyBodyCommit = {
  before: string;
  after: string;
  bodyRevision: number;
  updatedAt: string;
};

export type LiveCopyAcceptCause = {
  ctx: ActionRunContext | undefined;
  operation: "accept-suggestion";
  origin: "suggestion";
};

export type LiveCopyAccept = {
  binding: LiveCopyBinding;
  /**
   * What the body persist of the attempt running in `tx` wrote, or undefined
   * when it derived nothing.
   */
  bodyCommit(tx: DbExec): LiveCopyBodyCommit | undefined;
  /** Locks the Page in `tx` in the order a body persist locks it. */
  lockPage(tx: DbExec, documentId: string): Promise<unknown>;
  /** Runs `run` with the History cause of its commits. */
  withWriteCause<T>(
    cause: LiveCopyAcceptCause,
    run: () => Promise<T>,
  ): Promise<T>;
};

/**
 * The Page went back to its legacy writer before the edit committed, so the
 * accept must run there instead. Nothing was decided or written.
 */
export class LiveCopyAcceptUnavailable extends Error {
  constructor(readonly documentId: string) {
    super(`Page ${documentId} is no longer written through its live copy`);
    this.name = "LiveCopyAcceptUnavailable";
  }
}

/** How a live-copy accept hands `apply` the edit it made. */
export type LiveCopyDecision =
  | {
      liveCopy: "committed" | "unchanged";
      steps: ReadonlyMap<string, ApplySuggestionStep>;
      /** Absent when the edit changed nothing. */
      commit?: LiveCopyBodyCommit;
      /** The body after each step `apply` has accepted so far. */
      text: string | null;
      applied: string[];
    }
  | {
      liveCopy: "refused";
      reason: ApplySuggestionRefusalReason;
    }
  /** The decision replayed while its edit was committing; never applies. */
  | { liveCopy: "replaying" };

export function isLiveCopyDecision(
  coordination: unknown,
): coordination is LiveCopyDecision {
  return (
    !!coordination &&
    typeof coordination === "object" &&
    "liveCopy" in coordination
  );
}

/**
 * Ranges of accepted suggestions saved from the same before-text. Proposals
 * list their members as siblings, so accepting one can remove the context
 * another is anchored to. Each accepted one is a range of that shared text
 * whose bytes may now differ; every other byte must still match for the
 * placement to succeed. Match on the operation's full before-text, not the
 * base revision token: the same text recurs under many body revisions, and
 * Comment AI suggestions carry the Page's updatedAt instead of a body token.
 */
export async function acceptedRangesOnSameText(
  tx: DbExec,
  suggestion: Pick<ResourceSuggestion, "id" | "resourceId" | "adapterKind">,
  beforeMarkdown: string,
): Promise<MarkdownRange[]> {
  const rows = (
    await tx.execute({
      sql: `SELECT o.anchor_json FROM agent_review_suggestions s
            INNER JOIN agent_review_suggestion_operations o ON o.suggestion_id = s.id
            WHERE s.resource_type = 'document' AND s.resource_id = ? AND s.adapter_kind = ?
              AND s.status = 'accepted' AND s.id <> ?
              AND (o.before_json::jsonb ->> 'markdown') = ?`,
      args: [
        suggestion.resourceId,
        suggestion.adapterKind,
        suggestion.id,
        beforeMarkdown,
      ],
    })
  ).rows;
  return rows.flatMap((row) => {
    const anchor = JSON.parse(
      String(row.anchor_json),
    ) as Partial<MarkdownRange> | null;
    // Saved as a whole before and after, it has no range to excuse.
    if (anchor === null) return [];
    return Number.isInteger(anchor.from) &&
      Number.isInteger(anchor.to) &&
      anchor.from! >= 0 &&
      anchor.from! <= anchor.to! &&
      anchor.to! <= beforeMarkdown.length
      ? [{ from: anchor.from!, to: anchor.to! }]
      : [];
  });
}

async function decidedMembers(context: SuggestionDecisionContext) {
  if (!context.proposalDecision) return [context.suggestion];
  const ids = context.proposalMemberIds;
  if (!ids?.length || ids[0] !== context.suggestion.id)
    throw new Error("A proposal decision did not list its members");
  return Promise.all(
    ids.map(async (id) => {
      const member = await getSuggestion(id);
      if (!member)
        fail("A proposal member is unavailable", {
          statusCode: 409,
          errorCode: "suggestion_conflict",
        });
      return member;
    }),
  );
}

/**
 * One step per member. Ranges read here may miss a sibling accepted since,
 * which only makes placement stricter: a placement that succeeds is still
 * exact.
 */
async function acceptSteps(members: ResourceSuggestion[]) {
  const steps = new Map<string, ApplySuggestionStep>();
  for (const member of members) {
    if (member.operations.length !== 1)
      throw new Error("Content suggestions must contain one operation");
    const operation = member.operations[0]!;
    const before = markdownPayload(operation.before, "before").markdown;
    const earlier = [...steps.values()].flatMap((step) => {
      if (markdownPayload(step.operation.before, "before").markdown !== before)
        return [];
      const { from, to } = operationAnchor(step.operation);
      return [{ from, to }];
    });
    steps.set(member.id, {
      operation,
      acceptedSiblingRanges: [
        ...(await acceptedRangesOnSameText(getDbExec(), member, before)),
        ...earlier,
      ],
    });
  }
  return steps;
}

class DecisionReplayed extends Error {
  constructor() {
    super("The suggestion was decided while its edit was committing");
    this.name = "DecisionReplayed";
  }
}

function isApplySuggestionRefusal(
  reason: string | undefined,
): reason is ApplySuggestionRefusalReason {
  return APPLY_SUGGESTION_REFUSALS.includes(
    reason as ApplySuggestionRefusalReason,
  );
}

/**
 * Accepts the decided suggestions on a Page whose body is its live copy. The
 * decision runs inside the edit's commit, where `apply` checks the edit and
 * writes nothing to the body: the body persist already has. Throws
 * LiveCopyAcceptUnavailable, having decided nothing, when the Page went back
 * to its legacy writer.
 */
export async function acceptOnLiveCopy<T>(
  context: SuggestionDecisionContext,
  run: (
    coordination?: unknown,
    options?: SuggestionDecisionRunOptions,
  ) => Promise<T>,
  liveCopy: LiveCopyAccept,
  requestSource: "agent" | undefined,
): Promise<T> {
  const steps = await acceptSteps(await decidedMembers(context));
  const syncEvent = {
    source: "action",
    type: "change",
    key: "decide-resource-suggestion",
    owner: context.suggestion.ownerEmail ?? undefined,
    orgId: context.suggestion.orgId ?? undefined,
    resourceType: context.resourceType,
    resourceId: context.resourceId,
  };
  let sync = await prepareTransactionalChange(syncEvent);
  let decided: { result: T } | undefined;
  try {
    await liveCopy.withWriteCause(
      {
        ctx: context.ctx as ActionRunContext | undefined,
        operation: "accept-suggestion",
        origin: "suggestion",
      },
      () =>
        mutateLiveCopy(liveCopy.binding, context.resourceId, {
          edit: APPLY_SUGGESTION_EDIT,
          input: { steps: [...steps.values()] } satisfies ApplySuggestionInput,
          ...(requestSource ? { requestSource } : {}),
          persist: async (tx, change) => {
            decided = undefined;
            const commit = change.changed ? liveCopy.bodyCommit(tx) : undefined;
            if (change.changed && !commit)
              throw new LiveCopyAcceptUnavailable(context.resourceId);
            if (!change.changed) {
              // An edit that changed nothing commits no body, so nothing has
              // locked the Page yet, and the decision locks it after rows a
              // body write locks first.
              await liveCopy.lockPage(tx, context.resourceId);
              // A peer that committed since the edit read the copy wrote the
              // rows just locked. Deciding nothing lets core redo the edit on
              // the peer's state.
              if (
                (await loadYDocVersion(context.resourceId)) !== change.version
              )
                return;
            }
            const coordination: LiveCopyDecision = {
              liveCopy: change.changed ? "committed" : "unchanged",
              steps,
              ...(commit ? { commit } : {}),
              text: null,
              applied: [],
            };
            const result = await run(coordination, { transaction: tx });
            // A replayed decision returns without applying, and its edit must
            // not commit.
            if (coordination.applied.length !== steps.size)
              throw new DecisionReplayed();
            // An event persists once, and an earlier attempt's rolled back.
            if (sync.isPersisted())
              sync = await prepareTransactionalChange(syncEvent);
            await sync.persist(tx);
            decided = { result };
          },
        }),
    );
  } catch (error) {
    if (error instanceof DecisionReplayed)
      return run({ liveCopy: "replaying" } satisfies LiveCopyDecision);
    if (error instanceof LiveCopyError && error.code === "not_live_copy")
      throw new LiveCopyAcceptUnavailable(context.resourceId);
    if (
      error instanceof LiveCopyError &&
      error.code === "build_refused" &&
      isApplySuggestionRefusal(error.reason)
    )
      return run({
        liveCopy: "refused",
        reason: error.reason,
      } satisfies LiveCopyDecision);
    throw error;
  }
  if (!decided)
    throw new Error("The accepted suggestion committed without its decision");
  sync.publish();
  return decided.result;
}
