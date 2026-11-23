import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { openPublishedAppSession } from "../server/model/published-app-sessions.js";
import {
  openAppSessionInput,
  appSessionProjectionSchema,
} from "../shared/app-session-operations.js";

export default defineAction({
  description:
    "Open or resume a private viewer session pinned to a published app release.",
  schema: openAppSessionInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: appSessionProjectionSchema,
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    openPublishedAppSession(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
