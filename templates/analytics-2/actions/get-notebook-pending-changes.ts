import { defineAction, defineActionErrors } from "@agent-native/core/action";

import { getNotebookPendingChanges } from "../server/model/notebook-proposals.js";
import {
  currentNotebookThreadScope,
  reviewContextRequired,
} from "../server/model/thread-projects.js";
import {
  getNotebookPendingChangesSchema,
  notebookPendingChangesSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "Read a notebook conversation's pending changes, candidate runs, and review decisions.",
  schema: getNotebookPendingChangesSchema,
  outputSchema: notebookPendingChangesSchema,
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  errors: defineActionErrors(
    "thread_not_found",
    "review_context_required",
    "review_forbidden",
    "project_not_found",
  ),
  run: async (input, context) => {
    if (context?.threadId && context.threadId !== input.threadId)
      reviewContextRequired();
    return getNotebookPendingChanges(
      await currentNotebookThreadScope(context),
      input,
    );
  },
});
