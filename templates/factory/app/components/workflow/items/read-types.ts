// The shapes the workflow read actions return, typed straight from the server
// read models so the views cannot drift from what the actions send. Type-only:
// nothing from `server/` reaches the client bundle.
import type {
  ActivityEntry,
  ActivityLink,
  ChangeActivity,
  NeedsYouActivity,
  RunActivity,
} from "../../../../server/workflow-host/activity-feed.js";
import type {
  ItemJourney as ItemJourneyData,
  ItemParking,
  ItemRow,
  JourneyEvent,
  JourneyStep,
  NeedsYouReason,
  NodeAudit,
  NodeAuditInput,
  NodeAuditOutput,
  NodeAuditStep,
  PathNode,
  ReadPage,
  ReceiptView,
  SampledItem,
} from "../../../../server/workflow-host/read-models.js";
import type {
  EndOutcome,
  ItemEventKind,
  NodeKind,
  RunMode,
  RunStatus,
  StepStatus,
} from "../../../../server/workflow/contract.js";

export type {
  ActivityEntry,
  EndOutcome,
  ActivityLink,
  ChangeActivity,
  ItemEventKind,
  ItemJourneyData,
  ItemParking,
  ItemRow,
  JourneyEvent,
  JourneyStep,
  NeedsYouActivity,
  NeedsYouReason,
  NodeAudit,
  NodeAuditInput,
  NodeAuditOutput,
  NodeAuditStep,
  NodeKind,
  PathNode,
  ReadPage,
  ReceiptView,
  RunActivity,
  RunMode,
  RunStatus,
  SampledItem,
  StepStatus,
};

export interface ActivityPageData {
  entries: ActivityEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface WorkflowOption {
  id: string;
  name: string;
}

export interface WorkflowListData {
  workflows: Array<{ id: string; name: string; enabled: boolean }>;
  hasMore: boolean;
}

/**
 * Where a view asks the page to open a workflow: the workflow, and optionally
 * a step to select, a run to replay, or a saved version to show. The two
 * callbacks of the page take `(workflowId, nodeId?)`; the third argument is
 * optional so a page that only handles those two still type-checks.
 */
interface WorkflowOpenTarget {
  runId?: string;
  version?: number;
}

export type OpenWorkflow = (
  workflowId: string,
  nodeId?: string,
  target?: WorkflowOpenTarget,
) => void;

/** One item a view can open in the journey sheet. */
export interface ItemTarget {
  workflowId: string;
  itemId: string;
  title?: string | null;
}
