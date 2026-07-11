/**
 * Extended frontmatter for triggers (superset of JobFrontmatter).
 *
 * Stored as markdown resources under `jobs/` — reuses the same storage
 * and scheduler infrastructure. Event-triggered jobs are skipped by the
 * cron scheduler and dispatched by the event bus instead.
 */

export interface TriggerFrontmatter {
  schedule: string;
  enabled: boolean;
  /** "schedule" = cron-based (legacy jobs). "event" = fires on bus event. */
  triggerType: "schedule" | "event";
  /** For event triggers: the event name to subscribe to. */
  event?: string;
  /** Natural-language condition evaluated by Haiku before dispatch. */
  condition?: string;
  /**
   * "agentic" = full runAgentLoop; the only mode `manage-automations` will
   * define/update going forward. "deterministic" was removed from the
   * advertised surface (never implemented) and is legacy-only: rows created
   * before the removal may still carry it, and the dispatcher's
   * warn-and-skip branch keeps them inert by design — do not make them fire.
   */
  mode: "agentic" | "deterministic";
  /** Domain tag for filtering in per-template UIs. */
  domain?: string;
  createdBy?: string;
  orgId?: string;
  runAs?: "creator" | "shared";
  lastRun?: string;
  lastStatus?: "success" | "error" | "running" | "skipped";
  lastError?: string;
  nextRun?: string;
}

export interface TriggerDispatchContext {
  triggerName: string;
  triggerBody: string;
  meta: TriggerFrontmatter;
  eventPayload?: unknown;
}
