export const PROGRESS_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export interface AgentRun {
  id: string;
  owner: string;
  title: string;
  step?: string;
  percent: number | null;
  status: ProgressStatus;
  metadata?: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StartRunInput {
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
  status?: ProgressStatus;
}

export interface ListRunsOptions {
  activeOnly?: boolean;
  limit?: number;
  event?: unknown;
}
