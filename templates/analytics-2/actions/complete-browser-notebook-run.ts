import { defineAction } from "@agent-native/core/action";

import {
  browserNotebookCompletionInput,
  browserNotebookCompletionOutput,
  BROWSER_RESULT_SUBMISSION_BYTES,
  saveBrowserNotebookCompletion,
} from "../server/execution/browser-notebook-result.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";

export default defineAction({
  description:
    "Save ordered browser kernel output and dataframe exports for an admitted attempt.",
  schema: browserNotebookCompletionInput,
  outputSchema: browserNotebookCompletionOutput,
  http: { method: "POST" },
  maxBodyBytes: BROWSER_RESULT_SUBMISSION_BYTES + 4096,
  uiOnly: true,
  run: async (input, context) =>
    saveBrowserNotebookCompletion(
      await currentExecutionActor(context?.caller ?? "frontend"),
      input,
    ),
});
