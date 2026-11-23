import { defineAction, defineActionErrors } from "@agent-native/core/action";

import { listLegacyNotebookProposals } from "../server/model/notebook-legacy-proposals.js";
import { currentNotebookThreadScope } from "../server/model/thread-projects.js";
import {
  notebookLegacyProposalsSchema,
  notebookThreadInputSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "List earlier SQL proposals without a proven notebook conversation binding. Only the project owner can read them.",
  schema: notebookThreadInputSchema.pick({ projectId: true }),
  outputSchema: notebookLegacyProposalsSchema,
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  uiOnly: true,
  errors: defineActionErrors("project_not_found", "legacy_proposal_not_found"),
  run: async ({ projectId }, context) =>
    listLegacyNotebookProposals(
      await currentNotebookThreadScope(context),
      projectId,
    ),
});
