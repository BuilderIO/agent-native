import { defineAction } from "@agent-native/core/action";

import {
  currentResultActor,
  setNotebookResultView,
  setNotebookResultViewInput,
  setNotebookResultViewOutput,
} from "../server/model/notebook-results.js";

export default defineAction({
  description:
    "Save the selected page for the current notebook result using its view revision.",
  schema: setNotebookResultViewInput,
  outputSchema: setNotebookResultViewOutput,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) =>
    setNotebookResultView(
      await currentResultActor(context?.caller ?? "unknown"),
      input,
    ),
});
