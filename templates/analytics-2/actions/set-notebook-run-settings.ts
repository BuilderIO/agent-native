import { defineAction } from "@agent-native/core/action";

import {
  setNotebookRunSettings,
  setNotebookRunSettingsInput,
  setNotebookRunSettingsOutput,
} from "../server/model/notebook-execution/draft-state.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";

export default defineAction({
  description:
    "Change the notebook's default cell run mode or whether saving input values reruns dependent cells.",
  schema: setNotebookRunSettingsInput,
  outputSchema: setNotebookRunSettingsOutput,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) =>
    setNotebookRunSettings(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
