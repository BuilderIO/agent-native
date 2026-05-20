/**
 * Reserved-job registry.
 *
 * Templates that ship their own native background loops (TypeScript cron in
 * `server/plugins/*.ts`, etc.) call `registerReservedJob()` at server startup
 * to reserve job names. Both `manage-jobs.create` and `manage-automations.define`
 * consult this registry and refuse to create matching `jobs/*.md` resources,
 * surfacing `reason` back to the agent.
 *
 * This prevents the agent from accidentally duplicating native cron loops as
 * agentic automations (each `runAgentLoop` tick burns LLM credits even when
 * the loop has nothing to do).
 */

export interface ReservedJob {
  /** Exact slug name (e.g. "send-due-steps") or RegExp tested against the slug. */
  name: string | RegExp;
  /** Shown to the agent when a reservation blocks creation. */
  reason: string;
}

const reserved: ReservedJob[] = [];

/** Reserve a job name (or pattern) so agentic creation is refused. */
export function registerReservedJob(entry: ReservedJob): void {
  reserved.push(entry);
}

/** Find the first reservation matching `name`, or undefined. */
export function findReservedJob(name: string): ReservedJob | undefined {
  return reserved.find((entry) =>
    typeof entry.name === "string"
      ? entry.name === name
      : entry.name.test(name),
  );
}

/** Test-only: clear all reservations. */
export function __clearReservedJobs(): void {
  reserved.length = 0;
}
