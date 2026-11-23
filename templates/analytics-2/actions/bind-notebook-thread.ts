import { defineAction, defineActionErrors } from "@agent-native/core/action";

import {
  bindNotebookThread,
  currentNotebookThreadScope,
} from "../server/model/thread-projects.js";
import {
  bindNotebookThreadSchema,
  notebookThreadBindingSchema,
} from "../shared/notebook-proposals.js";

export default defineAction({
  description:
    "Bind an existing conversation to the active notebook draft for proposal review.",
  schema: bindNotebookThreadSchema,
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
    bindNotebookThread(await currentNotebookThreadScope(context), input),
});
