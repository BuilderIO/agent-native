export type ProgressStatus = "running" | "succeeded" | "failed" | "cancelled";

/**
 * A long-running agent task the UI can track. Separate from "notifications":
 * notifications fire once ("X happened"), progress is continuous state
 * ("X is 45% done"). Both primitives may interop — completed runs commonly
 * emit a notification.
 */
export interface AgentRun {
  id: string;
  owner: string;
  /** Human-readable title, e.g. "Triage 128 unread emails". */
  title: string;
  /** Optional free-text current step ("Fetching 23/100", "Drafting replies"). */
  step?: string;
  /** 0–100. `null` when the task has no known upper bound. */
  percent: number | null;
  status: ProgressStatus;
  /** Optional deeper context: link, thread id, artifact path, etc. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp — when the run was started. */
  startedAt: string;
  /** ISO timestamp — latest update. */
  updatedAt: string;
  /** ISO timestamp — when the run reached a terminal status. */
  completedAt: string | null;
}

export interface StartRunInput {
  /** Client-provided id — optional; server generates a UUID when omitted. */
  id?: string;
  owner: string;
  title: string;
  step?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProgressInput {
  percent?: number | null;
  step?: string;
  metadata?: Record<string, unknown>;
  /** Optional terminal status — sets completedAt when `succeeded|failed|cancelled`. */
  status?: ProgressStatus;
}

export interface ListRunsOptions {
  /** When true, only return runs with status = "running". */
  activeOnly?: boolean;
  /** Max rows. Default 50. */
  limit?: number;
}
