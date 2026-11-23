import { defineAction } from "@agent-native/core/action";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { listNotebookChanges } from "../server/model/notebook-operations/events.js";
import {
  notebookChangesInputSchema,
  notebookChangesReadSchema,
} from "../shared/notebook-operations.js";

export default defineAction({
  description:
    "Read an ordered page of notebook changes after a journal cursor.",
  schema: notebookChangesInputSchema,
  outputSchema: notebookChangesReadSchema,
  outputErrorStrategy: "strict",
  readOnly: true,
  run: async ({ projectId, after, limit }) =>
    listNotebookChanges(
      await requireCurrentWorkspace(),
      projectId,
      after,
      limit,
    ),
});
