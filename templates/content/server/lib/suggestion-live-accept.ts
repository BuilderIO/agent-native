import {
  fail,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { LiveCopyError } from "@agent-native/core/collab";
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
import {
  persistedContentBodyCommit,
  type PersistedContentBodyCommit,
} from "../live-copy/persist.js";
import { editContentLiveCopy } from "../live-copy/write.js";

// On a Page whose body is its live copy, accepting is one live-copy edit that
// places exactly the accepted suggestions, and the decision commits in that
// edit's transaction. A decision never commits without its edit, nor the
// edit without its decision.

/**
 * The Page stopped taking writes through its live copy before the edit
 * committed. Nothing was decided or written; read the gate again to choose
 * the writer.
 */
export class LiveCopyAcceptUnavailable extends Error {
  constructor(
    readonly documentId: string,
    /** The writer's own refusal, for a caller that stops retrying. */
    readonly refusal: unknown,
  ) {
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
      commit?: PersistedContentBodyCommit;
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
      // Saved as a whole before and after, it has no range to excuse.
      if (
        step.operation.anchor == null ||
        markdownPayload(step.operation.before, "before").markdown !== before
      )
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
 * LiveCopyAcceptUnavailable, having decided nothing, when the Page stopped
 * taking writes through its live copy.
 */
export async function acceptOnLiveCopy<T>(
  context: SuggestionDecisionContext,
  run: (
    coordination?: unknown,
    options?: SuggestionDecisionRunOptions,
  ) => Promise<T>,
  page: { ownerEmail: string },
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
    await editContentLiveCopy(context.resourceId, {
      cause: {
        ctx: context.ctx as ActionRunContext | undefined,
        operation: "accept-suggestion",
        origin: "suggestion",
        // A stale save across the accept merges only past a recorded intent.
        intent: {
          intent: {
            writerId: `suggestion:${page.ownerEmail}`,
            operationId: context.suggestion.id,
          },
        },
      },
      edit: APPLY_SUGGESTION_EDIT,
      input: { steps: [...steps.values()] } satisfies ApplySuggestionInput,
      ...(requestSource ? { requestSource } : {}),
      persist: async (tx, change) => {
        decided = undefined;
        const commit = change.changed
          ? persistedContentBodyCommit(tx)
          : undefined;
        if (change.changed && !commit)
          throw new Error("The accepted suggestion's edit wrote no body");
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
    });
  } catch (error) {
    if (error instanceof DecisionReplayed)
      return run({ liveCopy: "replaying" } satisfies LiveCopyDecision);
    if (
      (error instanceof LiveCopyError && error.code === "not_live_copy") ||
      (isActionContractError(error) &&
        error.errorCode === "LIVE_BODY_WRITE_PATH_CHANGED")
    )
      throw new LiveCopyAcceptUnavailable(context.resourceId, error);
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
