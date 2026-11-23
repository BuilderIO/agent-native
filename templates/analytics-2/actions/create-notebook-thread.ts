import { defineAction, defineActionErrors } from "@agent-native/core/action";

import {
  createNotebookThread,
  currentNotebookThreadScope,
} from "../server/model/thread-projects.js";
import {
  createNotebookThreadSchema,
  notebookThreadBindingSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "Create and bind a private conversation to the active notebook draft.",
  schema: createNotebookThreadSchema,
  outputSchema: notebookThreadBindingSchema,
  outputErrorStrategy: "strict",
  uiOnly: true,
  retrySafe: true,
  errors: defineActionErrors(
    "thread_not_found",
    "review_forbidden",
    "project_not_found",
    "proposal_base_changed",
  ),
  run: async (input, context) =>
    createNotebookThread(await currentNotebookThreadScope(context), input),
});
