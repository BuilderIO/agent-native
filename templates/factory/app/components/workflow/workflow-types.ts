import type { WorkflowGraph } from "@/lib/workflow-editor";

import type { WorkflowJobHealth } from "../../../server/lib/factory-workflow-job.js";
import type {
  ItemRow,
  RunDetail,
  RunView,
} from "../../../server/workflow-host/read-models.js";

// What the workflow actions return, as the page reads it. The read models are
// the server's own types, so a change to one fails the build here.

export type { RunDetail, RunView, WorkflowJobHealth };
export type WorkflowItemRow = ItemRow;

export interface WorkflowSummaryRow {
  id: string;
  automationId: string | null;
  name: string;
  version: number;
  enabled: boolean;
  lastCleanDryRunVersion: number | null;
  dryRunCurrent: boolean;
  lastTriggerAt: string | null;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
  job: WorkflowJobHealth;
}

export interface ListWorkflowsResult {
  workflows: WorkflowSummaryRow[];
  hasMore: boolean;
}

export interface GetWorkflowResult extends Omit<WorkflowSummaryRow, "job"> {
  currentVersion: number;
  graph: WorkflowGraph;
  job: WorkflowJobHealth;
}

export interface ListRunsResult {
  runs: RunView[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ListItemsResult {
  items: ItemRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

type WorkflowVersionSourceKind = "save" | "agent" | "restore" | "template";

export interface WorkflowVersionRow {
  version: number;
  source: WorkflowVersionSourceKind;
  summary: string;
  createdAt: string;
  createdBy: string;
  current: boolean;
}

export interface ListVersionsResult {
  workflowId: string;
  currentVersion: number;
  versions: WorkflowVersionRow[];
  hasMore: boolean;
}

export interface SaveWorkflowResult {
  workflowId: string;
  version: number;
  created: boolean;
  enabled: boolean;
  lastCleanDryRunVersion: number | null;
  disabledBySave: boolean;
}

export interface RestoreWorkflowResult {
  workflowId: string;
  version: number;
  restoredFrom: number;
  enabled: boolean;
  disabledBySave: boolean;
}

export interface SetEnabledResult {
  workflowId: string;
  enabled: boolean;
  version: number;
}

export interface DeleteWorkflowResult {
  workflowId: string;
  deleted: true;
  jobRemoved: boolean;
  parkedItems: number;
}

export interface RunWorkflowResult {
  runId: string;
  status: string;
}

export type RunWorkflowMode = "dry" | "test" | "live";
