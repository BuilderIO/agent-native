import { defineAction, defineActionErrors } from "@agent-native/core/action";

import { recoverLegacyNotebookProposal } from "../server/model/notebook-legacy-proposals.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  notebookLegacyProposalRecoverySchema,
  recoverNotebookLegacyProposalSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "Discard an earlier unbound SQL proposal or place it in a notebook conversation for a new review.",
  schema: recoverNotebookLegacyProposalSchema,
  outputSchema: notebookLegacyProposalRecoverySchema,
  outputErrorStrategy: "strict",
  uiOnly: true,
  retrySafe: true,
  errors: defineActionErrors(
    "project_not_found",
    "legacy_proposal_not_found",
    "thread_not_found",
    "review_context_required",
    "review_forbidden",
    "overlay_conflict",
    "proposal_base_changed",
    "intent_mismatch",
    "invalid_proposal",
    "source_denied",
  ),
  run: async (input, context) =>
    recoverLegacyNotebookProposal(
      await currentNotebookThreadScope(context),
      input,
    ),
});
