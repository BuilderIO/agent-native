import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import { listDesignVersions } from "../server/lib/design-versions.js";
import { reviewAgentMachine } from "../server/lib/review-agent-machine.js";
import {
  dryRunEdits,
  failPatch,
  loadReviewAgentRequest,
  parseReviewAgentResult,
  postReviewAgentComment,
  previewEdits,
  readScreenFile,
  recordEditApplied,
  refuse,
  requireRequesterEmail,
  requireScopedRequest,
  resolveReviewAgentThread,
  reviewAgentEditsSchema,
  reviewAgentRequestSchema,
  reviewAgentScreenFacts,
  serializeResult,
  serializeReviewAgentRequest,
  transitionReviewAgentRequest,
  writeActiveResult,
  type ReviewAgentRow,
} from "../server/lib/review-agent.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import {
  REVIEW_AGENT_LIMITS,
  isReviewAgentActive,
  type ReviewAgentResult,
} from "../shared/review-agent.js";
import editDesign from "./edit-design.js";

const errors = defineActionErrors(
  "sign_in_required",
  "scope_required",
  "scope_mismatch",
  "binding_missing",
  "not_classified",
  "request_not_active",
  "intent_not_permitted",
  "thread_unavailable",
  "apply_unavailable",
  "apply_attempts_exhausted",
  "apply_incomplete",
  "no_change",
  "verification_failed",
  "target_changed",
  "target_ambiguous",
);

interface ReadbackCheck {
  before: string;
  after: string;
}

/** An edit landed if its replacement is in the saved text, or, for a deletion, its target is gone. */
function readbackMatches(
  content: string,
  checks: readonly ReadbackCheck[],
): boolean {
  return checks.every(({ before, after }) =>
    after === "" ? !content.includes(before) : content.includes(after),
  );
}

/** The "Before chat edit" checkpoint this run's edit made, for a later one-click undo. */
async function checkpointVersionId(
  designId: string,
  agentThreadId: string | null,
): Promise<string | null> {
  if (!agentThreadId) return null;
  const { versions } = await listDesignVersions(designId, 10);
  const checkpoint = versions.find(
    (version) => version.chatContext?.threadId === agentThreadId,
  );
  return checkpoint?.id ?? null;
}

/** Cancel, a lost permission or a closed thread may land between steps; none may be overtaken. */
async function stillActive(row: ReviewAgentRow): Promise<ReviewAgentRow> {
  const current = await loadReviewAgentRequest(row.id);
  if (!isReviewAgentActive(reviewAgentMachine.parseState(current.status))) {
    return refuse(
      "request_not_active",
      "This agent request ended before it finished.",
      409,
    );
  }
  return current;
}

const schema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(1_200)
    .describe(
      "The receipt the thread shows: one to three short sentences in the past tense naming the element and the before and after values.",
    ),
  edits: reviewAgentEditsSchema,
  requestId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Local development shell only. Leave it out inside an agent run.",
    ),
});

export default defineAction({
  description:
    "Apply exact search/replace edits to the review thread's screen, verify the saved result, post the receipt reply and resolve the thread. Only available in comment-started apply-and-resolve runs. If an edit no longer matches, read the screen again and retry; call it again after a partial failure and only the receipt and resolve are repeated.",
  http: false,
  mcpTool: false,
  // Not `retrySafe`: a search/replace edit whose result was lost may match its
  // own replacement text and apply twice, so a lost result stops the run.
  errors,
  schema,
  agentInputSchema: schema.omit({ requestId: true }),
  outputSchema: z.object({
    request: reviewAgentRequestSchema,
    receiptCommentId: z.string(),
    editsApplied: z.number(),
  }),
  audit: {
    target: (_args: unknown, result: unknown) => {
      const designId = (result as { request?: { designId?: string } } | null)
        ?.request?.designId;
      return designId ? { type: "design", id: designId } : null;
    },
  },
  run: async (args, ctx) => {
    const email = requireRequesterEmail();
    const scoped = await requireScopedRequest({
      ctx,
      phase: "execution",
      intents: ["apply-resolve"],
      argsRequestId: args.requestId,
      replayStatuses: ["applied"],
    });
    const { design, run } = scoped;
    let row = scoped.row;
    const answer = (current: ReviewAgentRow) => {
      const stored = parseReviewAgentResult(current);
      if (!stored?.receiptCommentId) {
        // guard:allow-bare-error — invariant: only this action writes `applied`, and it writes the receipt id with it
        throw new Error("An applied request has no receipt");
      }
      return {
        request: serializeReviewAgentRequest(current, email),
        receiptCommentId: stored.receiptCommentId,
        editsApplied: stored.editsApplied ?? 0,
      };
    };
    if (scoped.replay) return answer(row);

    const facts = await reviewAgentScreenFacts(design, row.screenId);
    if (!facts.screen || !facts.capabilities.canApply) {
      return errors.fail(
        "An agent cannot edit this screen. Ask the requester with post-review-agent-reply and needsInput instead.",
        "apply_unavailable",
        { statusCode: 400 },
      );
    }
    const fileId = facts.screen.screenId;

    let result: ReviewAgentResult = parseReviewAgentResult(row) ?? {};
    let checks: ReadbackCheck[];
    if (result.editApplied) {
      // A retry after a partial apply: the design is already edited, so only
      // what is saved is checked, against what was recorded. No record checks
      // nothing, which would pass, so it stops instead.
      if (!result.changes?.length) {
        return errors.fail(
          "The design was edited but no record of the edit was kept, so the saved screen cannot be verified. The request stays open for review.",
          "verification_failed",
          { statusCode: 409 },
        );
      }
      checks = result.changes;
    } else {
      const attempts = (result.applyAttempts ?? 0) + 1;
      if (attempts > REVIEW_AGENT_LIMITS.applyAttemptsMax) {
        await transitionReviewAgentRequest(
          row,
          "needInput",
          failPatch("apply_attempts_exhausted"),
        );
        return errors.fail(
          "Too many rejected attempts. Stop editing; the requester has been asked to decide.",
          "apply_attempts_exhausted",
          { statusCode: 409 },
        );
      }
      result = { ...result, applyAttempts: attempts };
      const counted = await writeActiveResult(row, result);
      if (!counted) {
        return refuse(
          "request_not_active",
          "This agent request ended before it finished.",
          409,
        );
      }
      row = counted;

      const file = await readScreenFile(row.designId, fileId);
      const live = await readLiveSourceFile(file);
      dryRunEdits(live.content, args.edits);
      // `designId` and `fileId` come from the request, never from the call, so
      // the agent cannot aim this at another design or screen.
      const edit = await editDesign.run(
        {
          designId: row.designId,
          fileId,
          mode: "search-replace",
          edits: args.edits,
        },
        { ...ctx, caller: "tool", actionName: "edit-design" },
      );
      if (!edit.changed) {
        return errors.fail(
          "The edits changed nothing, so the thread was not resolved.",
          "no_change",
          { statusCode: 400 },
        );
      }
      // Written the moment the edit returns: a crash or a cancel from here on
      // must still show that the design changed.
      result = {
        ...result,
        editApplied: true,
        fileId,
        editsApplied: edit.editsApplied,
        changes: previewEdits(args.edits),
      };
      row = await recordEditApplied(row, result);
      checks = args.edits.map(({ search, replace }) => ({
        before: search,
        after: replace,
      }));
      row = await stillActive(row);
    }

    const saved = await readLiveSourceFile(
      await readScreenFile(row.designId, fileId),
    );
    if (!readbackMatches(saved.content, checks)) {
      return errors.fail(
        "The design was edited but the saved screen does not match the edit. The request stays open for review.",
        "verification_failed",
        { statusCode: 409 },
      );
    }

    // The edit is saved from here on, so a failure leaves the request running
    // for a retry that repeats only the receipt and the resolve.
    const incomplete = (error: unknown) => {
      if (error instanceof ForbiddenError) throw error;
      const reason = error instanceof Error ? error.message : "unknown error";
      return errors.fail(
        `The design was edited, but the receipt or resolving the thread failed (${reason.slice(0, 200)}). Call this action again with the same edits to finish.`,
        "apply_incomplete",
        { statusCode: 409 },
      );
    };
    try {
      const receipt = await postReviewAgentComment({
        row,
        ctx,
        run,
        kind: "receipt",
        body: args.summary,
        metadata: { editsApplied: result.editsApplied, fileId },
      });
      result = { ...result, receiptCommentId: receipt.commentId };
    } catch (error) {
      return incomplete(error);
    }
    row = await stillActive(row);
    try {
      await resolveReviewAgentThread(row, ctx);
    } catch (error) {
      return incomplete(error);
    }

    const versionId =
      result.versionId !== undefined
        ? result.versionId
        : await checkpointVersionId(row.designId, row.agentThreadId);
    result = { ...result, resolved: true, versionId };
    const finished = await transitionReviewAgentRequest(row, "apply", {
      resultJson: serializeResult(result),
      errorCode: null,
      error: null,
    });
    if (!finished) {
      const current = await loadReviewAgentRequest(row.id);
      if (reviewAgentMachine.parseState(current.status) === "applied") {
        return answer(current);
      }
      return refuse(
        "request_not_active",
        "This agent request ended before it finished.",
        409,
      );
    }
    return answer(finished);
  },
});
