import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  scheduledTriggerAvailability,
  type ScheduledTriggerAvailability,
} from "../../server/agent-chat/recurring-jobs-runtime.js";

export type ScheduledTriggerStatus = ScheduledTriggerAvailability;

export default defineAction({
  description:
    "Report whether schedule-triggered automations can actually fire in this deploy, and which driver (or missing driver) decides that. Used by the Agent Automations page to warn that a schedule will never run.",
  agentTool: false,
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (): Promise<ScheduledTriggerStatus> =>
    scheduledTriggerAvailability(),
});
