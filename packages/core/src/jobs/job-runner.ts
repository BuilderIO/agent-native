import type { ActionAutomationContext } from "../action.js";
import type { JobFrontmatter } from "./frontmatter.js";

export type JobRunnerResult =
  | { status: "success"; runId?: string }
  | { status: "skipped"; reason: string; runId?: string };

export interface JobRunnerContext {
  name: string;
  path: string;
  meta: JobFrontmatter;
  ownerEmail: string;
  orgId?: string;
  /** The `automation_runs` row the scheduler opened for this tick. */
  historyId: string;
  manual: boolean;
  /** The due instant a scheduled tick fired for; `null` for a manual run. */
  scheduledFor: string | null;
  /** Epoch ms the runner should stop starting new work. */
  deadlineAt: number;
  /** Epoch ms the scheduler abandons the runner and records a timeout. */
  hardDeadlineAt: number;
  /** Aborts at `hardDeadlineAt`. */
  signal: AbortSignal;
  /** Rejects once this worker no longer owns the tick. */
  assertCanContinue(): Promise<void>;
  actionAutomation: ActionAutomationContext;
}

export type JobRunner = (ctx: JobRunnerContext) => Promise<JobRunnerResult>;

const runners = new Map<string, JobRunner>();

export function registerJobRunner(id: string, runner: JobRunner): () => void {
  const key = id.trim();
  if (!key) throw new Error("Job runner id is required.");
  runners.set(key, runner);
  return () => {
    if (runners.get(key) === runner) runners.delete(key);
  };
}

export function hasJobRunner(id: string): boolean {
  return runners.has(id);
}

export function getJobRunner(id: string): JobRunner | undefined {
  return runners.get(id);
}
