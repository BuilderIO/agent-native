import { failWorkflowAction } from "../lib/workflow-action-errors.js";
import { actionTripwire } from "../lib/workflow-run-observer.js";
import type { TripwireSink } from "../tripwire/types.js";
import {
  OPERATION_CATALOG,
  workflowGraphSchema,
  operationUse,
  WorkflowStoreError,
  type OperationCatalog,
  type WorkflowGraph,
  type WorkflowScope,
  type WorkflowStore,
} from "../workflow/index.js";
import { getWorkflowStore } from "./factory-store.js";

/**
 * The action that runs a `provider-request` operation. It is one action for
 * many operations, so the gate also checks which operation the call names.
 */
export const RUN_WORKFLOW_OPERATION_ACTION = "run-workflow-operation";

// Source nodes that read the Factory inbox have no operation id: the poller
// they name is the action they call.
const INBOX_POLL_ACTIONS = {
  slack: ["poll-slack-channel", "list-triage-items"],
  github: ["poll-github-sources", "list-triage-items"],
  sentry: ["poll-sentry-errors", "list-triage-items"],
} as const;
const STATUS_SOURCE_ACTIONS = ["list-factory-items"] as const;
// A reply Wait names no operation, but the engine reads the thread it watches
// to see whether anyone answered.
const REPLY_WAIT_ACTIONS = ["read-slack-thread"] as const;

interface GraphActionAccess {
  /** Actions a node's operation, or a Source's kind, runs directly. */
  actions: ReadonlySet<string>;
  /** `provider-request` operations the graph may run through the wrapper. */
  providerOperations: ReadonlySet<string>;
}

/**
 * What a saved graph is allowed to call. Operations resolve through the code
 * catalog: the graph stores only ids, so editing it can never widen what an id
 * means. An id the catalog no longer knows names nothing.
 */
export function actionsNamedByGraph(
  graph: WorkflowGraph,
  catalog: OperationCatalog = OPERATION_CATALOG,
): GraphActionAccess {
  const actions = new Set<string>();
  const providerOperations = new Set<string>();

  const admit = (operationId: string, readsOnly: boolean) => {
    const definition = catalog.get(operationId);
    if (!definition) return;
    if (readsOnly && definition.effect !== "read") return;
    const { implementation } = definition;
    if (implementation.type === "action") actions.add(implementation.action);
    else if (implementation.type === "provider-request") {
      providerOperations.add(definition.id);
      actions.add(RUN_WORKFLOW_OPERATION_ACTION);
    }
  };

  for (const node of graph.nodes) {
    const use = operationUse(node);
    if (use) admit(use.id, false);
    if (node.kind === "source" && node.settings.source === "inbox-poll") {
      for (const action of INBOX_POLL_ACTIONS[node.settings.poller]) {
        actions.add(action);
      }
    }
    if (node.kind === "source" && node.settings.source === "status") {
      for (const action of STATUS_SOURCE_ACTIONS) actions.add(action);
    }
    if (node.kind === "wait" && node.settings.wait === "reply") {
      for (const action of REPLY_WAIT_ACTIONS) actions.add(action);
    }
    // An AI node's tools read; a write operation listed there grants nothing.
    if (node.kind === "ai") {
      for (const tool of node.settings.tools) admit(tool, true);
    }
  }
  return { actions, providerOperations };
}

interface GraphNamesActionInput {
  orgId: string;
  factoryId: string;
  /** The job's resource id: what the workflow row is keyed by. */
  automationId: string;
  actionName: string | undefined;
  /** Required for `run-workflow-operation`, which serves many operations. */
  operationId?: string;
}

interface GraphNamesActionDeps {
  store?: Pick<WorkflowStore, "getWorkflowByAutomation">;
  catalog?: OperationCatalog;
  /** Where a denial is reported; the run's own, else the factory's. */
  tripwire?: TripwireSink;
}

/**
 * Whether the current saved graph of this workflow job names `actionName`.
 * A workflow with no saved row, or whose graph no longer parses, throws: an
 * unreadable graph is never an empty one that merely refuses.
 */
export async function graphNamesAction(
  input: GraphNamesActionInput,
  deps: GraphNamesActionDeps = {},
): Promise<boolean> {
  const scope: WorkflowScope = {
    orgId: input.orgId,
    factoryId: input.factoryId,
  };
  const store = deps.store ?? getWorkflowStore();
  const denied = (reason: string, workflowId?: string) =>
    (deps.tripwire ?? actionTripwire(scope))({
      area: "gate",
      code: "operation_gate_denied",
      severity: "warn",
      ...(workflowId === undefined ? {} : { workflowId }),
      ...(input.operationId === undefined
        ? {}
        : { operationId: input.operationId }),
      details: {
        reason,
        actionName: input.actionName ?? null,
        automationId: input.automationId,
      },
    });
  let record;
  try {
    record = await store.getWorkflowByAutomation(scope, input.automationId);
  } catch (error) {
    if (
      error instanceof WorkflowStoreError &&
      error.code === "corrupt_record"
    ) {
      denied("workflow_graph_unreadable");
      return failWorkflowAction({
        message:
          "The saved workflow graph cannot be read, so no action is allowed for it until it is fixed.",
        errorCode: "workflow_graph_unreadable",
        statusCode: 500,
        details: { automationId: input.automationId },
      });
    }
    throw error;
  }
  if (!record) {
    denied("workflow_not_found");
    return failWorkflowAction({
      message: "This workflow job has no saved workflow to allow actions from.",
      errorCode: "workflow_not_found",
      statusCode: 404,
      details: { automationId: input.automationId },
    });
  }
  const parsed = workflowGraphSchema.safeParse(record.graph);
  if (!parsed.success) {
    denied("workflow_graph_unreadable", record.id);
    return failWorkflowAction({
      message:
        "The saved workflow graph does not match the graph contract, so no action is allowed for it until it is fixed.",
      errorCode: "workflow_graph_unreadable",
      statusCode: 500,
      details: { automationId: input.automationId, workflowId: record.id },
    });
  }
  if (!input.actionName) {
    denied("no_action_name", record.id);
    return false;
  }
  const access = actionsNamedByGraph(parsed.data, deps.catalog);
  if (!access.actions.has(input.actionName)) {
    denied("action_not_named", record.id);
    return false;
  }
  if (input.actionName !== RUN_WORKFLOW_OPERATION_ACTION) return true;
  const named =
    input.operationId !== undefined &&
    access.providerOperations.has(input.operationId);
  if (!named) denied("operation_not_named", record.id);
  return named;
}
