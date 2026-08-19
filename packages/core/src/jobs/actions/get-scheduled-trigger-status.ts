import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  scheduledTriggerAvailability,
  type ScheduledTriggerAvailability,
} from "../../server/agent-chat/recurring-jobs-runtime.js";

export type ScheduledTriggerStatus = ScheduledTriggerAvailability;

/**
 * Read surface for "will a schedule-triggered automation actually fire here".
 *
 * A separate action rather than a field on `list-automations` / `list-recurring-jobs`:
 * both of those return bare arrays that several callers map over directly, so
 * adding a sibling field means an envelope and a breaking change at every call
 * site. This is deploy-scoped rather than per-automation data anyway — it never
 * varies by row — so it caches independently and for much longer.
 */
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
