// Shared contract for the Analytics brain page. The server actions produce
// these shapes and the brain UI consumes them. Keep this file the single
// source of truth; change it here first, then update both sides.

export type IndexRunStatus = "running" | "succeeded" | "failed";
export type IndexRunTrigger = "manual" | "scheduled";

export interface IndexRunSummary {
  id: string;
  status: IndexRunStatus;
  trigger: IndexRunTrigger;
  startedAt: string;
  finishedAt: string | null;
  entryCount: number | null;
  /** Source id to the revision (commit SHA or file fingerprint) that was indexed. */
  sourceRevisions: Record<string, string>;
  error: string | null;
  createdByEmail: string | null;
}

export interface IndexSchedule {
  enabled: boolean;
  /** Five-field cron expression, validated by the automations service. */
  cron: string;
  timezone: string;
  /** Name of the scheduled automation, or null before the first save. */
  automationName: string | null;
}

export type BrainSourceStatus =
  | "connected"
  | "not-connected"
  | "needs-reauth"
  | "error";

export interface BrainSource {
  id: string;
  label: string;
  status: BrainSourceStatus;
  /** Short, user-safe detail such as the connected account or the failing check. */
  detail: string | null;
}

export type BrainIndexState =
  | "not-built"
  | "current"
  | "stale"
  | "running"
  | "failed";

export interface BrainOverview {
  index: {
    state: BrainIndexState;
    entryCount: number;
    generatedAt: string | null;
    lastRun: IndexRunSummary | null;
  };
  sources: BrainSource[];
  dictionary: { entryCount: number };
  schedule: IndexSchedule;
}

// Action surface. Read actions are GET; mutations are POST and admin-only.
//   get-brain-overview   GET   {}                          -> BrainOverview
//   list-index-runs      GET   { limit?: number }          -> IndexRunSummary[]
//   build-data-index     POST  { trigger?: IndexRunTrigger } -> IndexRunSummary
//   get-index-schedule   GET   {}                          -> IndexSchedule
//   set-index-schedule   POST  { enabled, cron, timezone } -> IndexSchedule
