import { defineAction } from "@agent-native/core/action";

import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { listPublishedAppSchedules } from "../server/model/published-app-schedules.js";
import {
  listSchedulesInput,
  listSchedulesOutput,
} from "../shared/published-app-schedules.js";

export default defineAction({
  description: "List published app schedules and their next due time.",
  schema: listSchedulesInput,
  outputSchema: listSchedulesOutput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  persistInBrowser: false,
  readOnly: true,
  http: { method: "GET" },
  run: async (input, context) =>
    listPublishedAppSchedules(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
    ),
});
