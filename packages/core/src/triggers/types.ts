import type {
  JobExecutionMode,
  JobFrontmatter,
  JobTriggerType,
} from "../jobs/frontmatter.js";

export interface TriggerFrontmatter extends JobFrontmatter {
  /**
   * "schedule" = cron-based, "event" = event-bus dispatch, "manual" =
   * explicit run-now only, and "webhook" = authenticated inbound request.
   */
  triggerType: JobTriggerType;
  mode: JobExecutionMode;
}

export interface TriggerDispatchContext {
  triggerName: string;
  triggerBody: string;
  meta: TriggerFrontmatter;
  eventPayload?: unknown;
}
