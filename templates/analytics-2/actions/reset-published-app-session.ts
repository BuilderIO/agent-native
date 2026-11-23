import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { mutatePublishedAppInputs } from "../server/model/published-app-sessions.js";
import {
  resetAppSessionInput,
  appSessionOperationOutput,
} from "../shared/app-session-operations.js";

export default defineAction({
  description:
    "Reset private input values and restore the published app session baseline.",
  schema: resetAppSessionInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: appSessionOperationOutput,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) =>
    mutatePublishedAppInputs(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
