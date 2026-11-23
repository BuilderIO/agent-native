import { defineAction, defineActionErrors } from "@agent-native/core/action";

import { requireNotebookToolIdentity } from "../server/lib/notebook-tool-context.js";
import { notebookProposalChatUI } from "../server/lib/notebook-tool-proposal.js";
import { stageNotebookProposal } from "../server/model/notebook-proposals.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import { agentNotebookProposalCommandSchema } from "../shared/notebook-operations.js";
import {
  stagedNotebookProposalSchema,
  stageNotebookProposalSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "Propose ordered notebook cell edits in the current conversation. Read the pending overlay first to obtain its revision. The edits remain pending for the user to review.",
  schema: stageNotebookProposalSchema,
  agentInputSchema: stageNotebookProposalSchema.extend({
    command: agentNotebookProposalCommandSchema,
  }),
  outputSchema: stagedNotebookProposalSchema,
  outputErrorStrategy: "strict",
  retrySafe: true,
  chatUI: notebookProposalChatUI,
  errors: defineActionErrors(
    "thread_not_found",
    "review_context_required",
    "review_forbidden",
    "project_not_found",
    "overlay_conflict",
    "proposal_base_changed",
    "intent_mismatch",
    "invalid_proposal",
    "source_denied",
  ),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) => {
    const identity = await requireNotebookToolIdentity(
      await currentNotebookThreadScope(context),
      context,
      input.threadId,
    );
    return stageNotebookProposal(identity.scope, input, identity);
  },
});
