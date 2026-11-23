import { defineAction } from "@agent-native/core/action";

import { notebookThreadMatches } from "../server/lib/notebook-tool-context.js";
import {
  currentResultActor,
  getNotebookRunDiagnostics,
  getNotebookRunDiagnosticsInput,
  getNotebookRunDiagnosticsOutput,
} from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Read the authorized diagnostic and redacted dispatch for a notebook attempt.",
  schema: getNotebookRunDiagnosticsInput,
  outputSchema: getNotebookRunDiagnosticsOutput,
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async (input, context) => {
    if (!notebookThreadMatches(context, input.threadId))
      return { status: "denied", reason: "access_denied" } as const;
    return getNotebookRunDiagnostics(
      await currentResultActor(context?.caller ?? "unknown"),
      input,
    );
  },
});
