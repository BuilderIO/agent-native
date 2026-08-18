/**
 * Extended frontmatter for triggers (superset of JobFrontmatter).
 *
 * Stored as markdown resources under `jobs/` — reuses the same storage
 * and scheduler infrastructure. Event-triggered jobs are skipped by the
 * cron scheduler and dispatched by the event bus instead.
 */

import type {
  JobExecutionMode,
  JobFrontmatter,
  JobTriggerType,
} from "../jobs/frontmatter.js";

export interface TriggerFrontmatter extends JobFrontmatter {
  /** "schedule" = cron-based (legacy jobs). "event" = fires on bus event. */
  triggerType: JobTriggerType;
  /**
   * "agentic" = full runAgentLoop; the only mode `manage-automations` will
   * define/update going forward. "deterministic" was removed from the
   * advertised surface (never implemented) and is legacy-only: rows created
   * before the removal may still carry it, and the dispatcher's
   * warn-and-skip branch keeps them inert by design — do not make them fire.
   */
  mode: JobExecutionMode;
}

export interface TriggerDispatchContext {
  triggerName: string;
  triggerBody: string;
  meta: TriggerFrontmatter;
  eventPayload?: unknown;
}
