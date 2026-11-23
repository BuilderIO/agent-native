import { defineAction } from "@agent-native/core/action";

import { notebookThreadMatches } from "../server/lib/notebook-tool-context.js";
import {
  findClaimableNotebookRunActor,
  getNotebookRunInput,
  getNotebookRunOutput,
  notebookExecution,
} from "../server/model/notebook-execution/service.js";

export default defineAction({
  description:
    "Read notebook run admission and ordered attempt events after a cursor.",
  schema: getNotebookRunInput,
  outputSchema: getNotebookRunOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (input, context) => {
    if (!notebookThreadMatches(context, input.threadId))
      return { status: "denied", reason: "access_denied" } as const;
    const execution = await notebookExecution(context?.caller ?? "unknown");
    const result = await execution.get(input);
    if (
      result.status === "found" &&
      result.run.attempts.some(
        ({ state }) => state.status === "queued" || state.status === "running",
      )
    ) {
      const claimableActor = await findClaimableNotebookRunActor(
        result.run.request.snapshot.ref.workspaceId,
        result.run.runId,
      );
      if (claimableActor) execution.wake(result.run.runId);
    }
    return result;
  },
});
