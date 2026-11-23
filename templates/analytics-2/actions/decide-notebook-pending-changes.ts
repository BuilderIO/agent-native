import { defineAction, defineActionErrors } from "@agent-native/core/action";

import { notebookChangeResource } from "../server/lib/project-action-access.js";
import { decideNotebookPendingChanges } from "../server/model/notebook-proposals.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  decideNotebookPendingChangesSchema,
  notebookProposalDecisionSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "Confirm or undo the exact notebook proposals reviewed in a conversation. Confirm all saves a version.",
  schema: decideNotebookPendingChangesSchema,
  outputSchema: notebookProposalDecisionSchema,
  outputErrorStrategy: "strict",
  uiOnly: true,
  retrySafe: true,
  changeResource: (input) =>
    input.decision === "confirm" ? notebookChangeResource(input) : null,
  errors: defineActionErrors(
    "thread_not_found",
    "review_context_required",
    "review_forbidden",
    "project_not_found",
    "overlay_conflict",
    "proposal_base_changed",
    "review_dependency_required",
    "intent_mismatch",
    "invalid_proposal",
    "source_denied",
  ),
  run: async (input, context) =>
    decideNotebookPendingChanges(
      await currentNotebookThreadScope(context),
      input,
    ),
});
