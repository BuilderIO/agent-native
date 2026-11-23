import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { notebookThreadMatches } from "../server/lib/notebook-tool-context.js";
import {
  getNotebookExecution,
  getNotebookExecutionOutput,
} from "../server/model/notebook-execution/draft-state.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";

export default defineAction({
  description:
    "Read a notebook's execution snapshot, current results, active run IDs, and run settings. For Ask analysis, include the bound thread ID.",
  schema: z.strictObject({
    projectId: z.string().min(1),
    threadId: z.string().min(1).max(128).optional(),
  }),
  outputSchema: getNotebookExecutionOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async ({ projectId, threadId }, context) => {
    if (!notebookThreadMatches(context, threadId))
      return { status: "denied", reason: "access_denied" } as const;
    return getNotebookExecution(
      await currentExecutionActor(context?.caller ?? "unknown"),
      projectId,
      threadId,
    );
  },
});
