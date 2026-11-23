import { defineAction } from "@agent-native/core/action";

import { phase1ScheduleFixture } from "../server/execution/phase1-schedule-fixture.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import { ensurePublishedAppScheduleTrigger } from "../server/model/published-app-schedule-trigger.js";
import { setPublishedAppSchedule } from "../server/model/published-app-schedules.js";
import {
  setScheduleInput,
  setScheduleOutput,
} from "../shared/published-app-schedules.js";

export default defineAction({
  description:
    "Create, edit, pause, resume, or delete a schedule for a published app.",
  schema: setScheduleInput,
  outputSchema: setScheduleOutput,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  persistInBrowser: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, context) =>
    setPublishedAppSchedule(
      await currentExecutionActor(context?.caller ?? "unknown"),
      input,
      phase1ScheduleFixture()?.now(input.projectId) ?? new Date(),
      ensurePublishedAppScheduleTrigger,
    ),
});
