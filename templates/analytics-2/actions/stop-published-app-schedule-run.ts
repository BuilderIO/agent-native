import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { stopPublishedAppScheduleRun } from "../server/model/published-app-schedules.js";
import {
  stopScheduleRunInput,
  stopScheduleRunOutput,
} from "../shared/published-app-schedules.js";

export default defineAction({
  description: "Stop an active scheduled run for a published app.",
  schema: stopScheduleRunInput,
  outputSchema: stopScheduleRunOutput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (input, context) =>
    stopPublishedAppScheduleRun(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
