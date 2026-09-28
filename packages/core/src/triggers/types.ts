import type {
  JobExecutionMode,
  JobFrontmatter,
  JobTriggerType,
} from "../jobs/frontmatter.js";

export interface TriggerFrontmatter extends JobFrontmatter {
  triggerType: JobTriggerType;
  mode: JobExecutionMode;
}

export interface TriggerDispatchContext {
  triggerName: string;
  triggerBody: string;
  meta: TriggerFrontmatter;
  eventPayload?: unknown;
}
