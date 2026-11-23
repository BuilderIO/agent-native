import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { refreshPublishedAppResults } from "../server/model/published-app-sessions.js";
import {
  refreshAppResultsInput,
  refreshAppResultsOutput,
} from "../shared/app-session-operations.js";

export default defineAction({
  description:
    "Refresh private session results or authorized published defaults.",
  schema: refreshAppResultsInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: refreshAppResultsOutput,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async (input, context) =>
    refreshPublishedAppResults(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
