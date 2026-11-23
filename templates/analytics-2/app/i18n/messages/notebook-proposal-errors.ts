export const notebookProposalErrors = {
  threadNotFound: "You don’t have access to this thread.",
  threadBoundElsewhere:
    "This conversation belongs to a different project than the one you ran. Open that project (open-project) and ask from its own conversation, or run cells only in this conversation’s project.",
  reviewForbidden: "You don’t have access to review changes in this thread.",
  reviewContextRequired: "Open a notebook thread to propose or review changes.",
  reviewContextRequiredWithoutThread:
    'This call has no notebook thread, so cells cannot be added or edited in place. To build a new query or chart, call create-project with starter: { kind: "cells", cells } holding the SQL cell and its chart cell. For an existing notebook, ask the person to open its notebook thread.',
  sourceDenied: "You don’t have access to this data source.",
  overlayConflict: "The pending changes changed. Review the latest changes.",
  baseChanged:
    "This cell changed while you were reviewing. Review the latest changes.",
  dependencyRequired: "Review the linked changes together.",
  intentMismatch: "This operation ID was already used for a different request.",
  invalidProposal: "The pending change could not be applied to this notebook.",
  limit: "Review some pending changes before adding more.",
  repairUnavailable: "This error is no longer available.",
  repairPrompt:
    "Verify, fix, and give a concise explanation about the following error in @{cell}\n\n{reason}",
  orphanNotFound: "That earlier pending change is unavailable.",
};
