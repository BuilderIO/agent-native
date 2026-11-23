import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { mutatePublishedAppInputs } from "../server/model/published-app-sessions.js";
import {
  setAppInputsInput,
  appSessionOperationOutput,
} from "../shared/app-session-operations.js";

export default defineAction({
  description:
    "Set private input values and rerun affected cells for a published app session.",
  schema: setAppInputsInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: appSessionOperationOutput,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async (input, context) =>
    mutatePublishedAppInputs(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
