import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { savePublishedAppView } from "../server/model/published-app-sessions.js";
import {
  saveAppViewInput,
  saveAppViewOutput,
} from "../shared/app-session-operations.js";

export default defineAction({
  description: "Save private input values as a view of this published release.",
  schema: saveAppViewInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: saveAppViewOutput,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    savePublishedAppView(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
