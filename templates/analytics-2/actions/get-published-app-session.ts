import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { getPublishedAppSession } from "../server/model/published-app-sessions.js";
import {
  getAppSessionInput,
  appSessionProjectionSchema,
} from "../shared/app-session-operations.js";

export default defineAction({
  description:
    "Read the app, inputs and verified results for a private viewer session.",
  schema: getAppSessionInput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: appSessionProjectionSchema,
  persistInBrowser: false,
  readOnly: true,
  http: { method: "GET" },
  run: async (input, context) =>
    getPublishedAppSession(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
