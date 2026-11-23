import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { listPublishedAppScheduleRuns } from "../server/model/published-app-schedules.js";
import {
  listScheduleRunsInput,
  listScheduleRunsOutput,
} from "../shared/published-app-schedules.js";

export default defineAction({
  description:
    "List pinned scheduled runs and their cache and notification outcomes.",
  schema: listScheduleRunsInput,
  outputSchema: listScheduleRunsOutput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  persistInBrowser: false,
  readOnly: true,
  http: { method: "GET" },
  run: async (input, context) =>
    listPublishedAppScheduleRuns(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
