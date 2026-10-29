import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import { reviewAgentMachine } from "../server/lib/review-agent-machine.js";
import {
  dryRunEdits,
  loadReviewAgentRequest,
  parseReviewAgentResult,
  postReviewAgentComment,
  previewEdits,
  readScreenFile,
  refuse,
  requireRequesterEmail,
  requireScopedRequest,
  resultFitsRow,
  reviewAgentEditsSchema,
  reviewAgentRequestSchema,
  reviewAgentScreenFacts,
  serializeResult,
  serializeReviewAgentRequest,
  transitionReviewAgentRequest,
} from "../server/lib/review-agent.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import type { ReviewAgentResult } from "../shared/review-agent.js";

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
  "no_change",
  "target_changed",
  "target_ambiguous",
);

const PREVIEW_LINE_CHARS = 160;

function inlineCode(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/`/g, "'").trim();
  const shown =
    flat.length > PREVIEW_LINE_CHARS
      ? `${flat.slice(0, PREVIEW_LINE_CHARS)}…`
      : flat;
  return `\`${shown}\``;
}

/** The proposal as the thread shows it: the summary, then what would change. */
function proposalBody(
  summary: string,
  changes: ReturnType<typeof previewEdits>,
): string {
  const lines = changes.map(
    ({ before, after }) => `- ${inlineCode(before)} → ${inlineCode(after)}`,
  );
  return [summary, ...(lines.length ? ["", ...lines] : [])].join("\n");
}

const schema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .describe(
      "One line saying what the change does, as it will appear in the thread.",
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
    "Propose edits for the review thread's screen without applying them. The edits are checked against the current screen and the thread posts your proposal; nothing is written to the design. Only available in comment-started suggest runs. If a check fails, read the screen again and retry.",
  http: false,
  mcpTool: false,
  // A repeated call returns the stored proposal and posts nothing new.
  retrySafe: true,
  errors,
  schema,
  agentInputSchema: schema.omit({ requestId: true }),
  outputSchema: z.object({
    request: reviewAgentRequestSchema,
    commentId: z.string(),
    editCount: z.number(),
  }),
  run: async (args, ctx) => {
    const email = requireRequesterEmail();
    const { row, design, run, replay } = await requireScopedRequest({
      ctx,
      phase: "execution",
      intents: ["suggest"],
      argsRequestId: args.requestId,
      replayStatuses: ["suggested"],
    });
    if (replay) {
      const stored = parseReviewAgentResult(row);
      if (!stored?.replyCommentId || !stored.proposal) {
        return refuse(
          "request_not_active",
          "This agent request already ended.",
          409,
        );
      }
      return {
        request: serializeReviewAgentRequest(row, email),
        commentId: stored.replyCommentId,
        editCount: stored.proposal.editCount,
      };
    }

    // A thread with no editable screen gets a reply, not a proposal.
    const facts = await reviewAgentScreenFacts(design, row.screenId);
    if (!facts.screen || !facts.capabilities.canApply) {
      return errors.fail(
        "An agent cannot edit this screen. Answer with post-review-agent-reply instead.",
        "apply_unavailable",
        { statusCode: 400 },
      );
    }
    const file = await readScreenFile(row.designId, facts.screen.screenId);
    const live = await readLiveSourceFile(file);
    dryRunEdits(live.content, args.edits);

    const changes = previewEdits(args.edits);
    const { commentId } = await postReviewAgentComment({
      row,
      ctx,
      run,
      kind: "proposal",
      body: proposalBody(args.summary, changes),
      metadata: { editCount: args.edits.length, fileId: file.id },
    });
    const withEdits: ReviewAgentResult = {
      ...parseReviewAgentResult(row),
      replyCommentId: commentId,
      proposal: {
        summary: args.summary,
        editCount: args.edits.length,
        edits: args.edits,
      },
    };
    // The edits are kept for a later one-click accept, but only while the
    // stored result stays small; past that, say so rather than cut them.
    const resultJson = serializeResult(
      resultFitsRow(withEdits)
        ? withEdits
        : {
            ...withEdits,
            proposal: {
              summary: args.summary,
              editCount: args.edits.length,
              truncated: true,
            },
          },
    );
    const finished = await transitionReviewAgentRequest(row, "suggest", {
      resultJson,
      errorCode: null,
      error: null,
    });
    if (!finished) {
      const current = await loadReviewAgentRequest(row.id);
      if (reviewAgentMachine.parseState(current.status) === "cancelled") {
        return refuse(
          "request_not_active",
          "This agent request was cancelled.",
          409,
        );
      }
      return {
        request: serializeReviewAgentRequest(current, email),
        commentId,
        editCount: args.edits.length,
      };
    }
    return {
      request: serializeReviewAgentRequest(finished, email),
      commentId,
      editCount: args.edits.length,
    };
  },
});
