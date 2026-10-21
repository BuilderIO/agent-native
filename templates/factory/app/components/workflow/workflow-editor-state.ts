import type {
  SelectionContext,
  WorkflowGraph,
  WorkflowIssue,
} from "@/lib/workflow-editor";

/** The application-state key the open workflow page keeps for the agent; the browser tab id is appended. */
export const WORKFLOW_EDITOR_STATE_KEY = "workflow-editor";

const MAX_ISSUES = 10;
const MAX_SELECTED = 20;
const MAX_DETAIL_CHARS = 160;
const MAX_NAME_CHARS = 120;
const MAX_CONTEXT_CHARS = 4000;

/**
 * What the URL says about the selection: one step, or one connection, or
 * nothing. A selection of several things has no single id to put in a link, so
 * it writes neither.
 */
export function urlParamsForSelection(selection: {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
}): { node: string | null; edge: string | null } {
  if (selection.nodeIds.length === 1) {
    return { node: selection.nodeIds[0] ?? null, edge: null };
  }
  if (selection.nodeIds.length === 0 && selection.edgeIds.length === 1) {
    return { node: null, edge: selection.edgeIds[0] ?? null };
  }
  return { node: null, edge: null };
}

/** Whether the graph on screen differs from the one last saved. */
export function isGraphDirty(
  graph: WorkflowGraph,
  saved: WorkflowGraph,
): boolean {
  return graph !== saved && JSON.stringify(graph) !== JSON.stringify(saved);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

interface IssueSummary {
  code: string;
  nodeId?: string;
  nodeName?: string;
  edgeId?: string;
  port?: string;
  detail?: string;
}

/** A bounded, plain copy of the problems, so a list of hundreds cannot fill a prompt or a state row. */
export function summarizeIssues(
  issues: readonly WorkflowIssue[],
  graph: WorkflowGraph,
): { issueCount: number; issues: IssueSummary[] } {
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  return {
    issueCount: issues.length,
    issues: issues.slice(0, MAX_ISSUES).map((issue) => ({
      code: issue.code,
      ...(issue.nodeId
        ? {
            nodeId: issue.nodeId,
            ...(names.has(issue.nodeId)
              ? { nodeName: names.get(issue.nodeId) }
              : {}),
          }
        : {}),
      ...(issue.edgeId ? { edgeId: issue.edgeId } : {}),
      ...(issue.port ? { port: issue.port } : {}),
      ...(issue.detail ? { detail: clip(issue.detail, MAX_DETAIL_CHARS) } : {}),
    })),
  };
}

interface WorkflowEditorAppState {
  workflowId: string;
  name: string;
  /** The version the graph on screen is based on. */
  baseVersion: number;
  dirty: boolean;
  saving: boolean;
  issueCount: number;
  issues: IssueSummary[];
  selection: { nodeIds: string[]; edgeIds: string[] };
  runId?: string;
}

/** What `view-screen` tells the agent about the open workflow beyond the URL. */
export function buildEditorAppState(input: {
  workflowId: string;
  name: string;
  baseVersion: number;
  dirty: boolean;
  saving: boolean;
  issues: readonly WorkflowIssue[];
  graph: WorkflowGraph;
  selection: { nodeIds: readonly string[]; edgeIds: readonly string[] };
  runId?: string | null;
}): WorkflowEditorAppState {
  const { issueCount, issues } = summarizeIssues(input.issues, input.graph);
  return {
    workflowId: input.workflowId,
    name: clip(input.name, MAX_NAME_CHARS),
    baseVersion: input.baseVersion,
    dirty: input.dirty,
    saving: input.saving,
    issueCount,
    issues,
    selection: {
      nodeIds: input.selection.nodeIds.slice(0, MAX_SELECTED),
      edgeIds: input.selection.edgeIds.slice(0, MAX_SELECTED),
    },
    ...(input.runId ? { runId: input.runId } : {}),
  };
}

/**
 * The context handed to the agent chat with "Ask the agent": which workflow,
 * what is selected, what is wrong. Ids and names, never the graph; the agent
 * reads the graph through `get-factory-workflow`.
 */
export function buildAgentContext(input: {
  factoryId: string;
  workflowId: string;
  name: string;
  version: number;
  enabled: boolean;
  dirty: boolean;
  selection: SelectionContext;
  issues: readonly WorkflowIssue[];
  graph: WorkflowGraph;
  runId?: string | null;
}): string {
  const { issueCount, issues } = summarizeIssues(input.issues, input.graph);
  const context = {
    surface: "factory-workflow-canvas",
    factoryId: input.factoryId,
    workflow: {
      id: input.workflowId,
      name: clip(input.name, MAX_NAME_CHARS),
      version: input.version,
      enabled: input.enabled,
      unsavedChanges: input.dirty,
    },
    selection: input.selection,
    issueCount,
    issues,
    ...(input.runId ? { runId: input.runId } : {}),
  };
  const json = JSON.stringify(context);
  if (json.length <= MAX_CONTEXT_CHARS) return json;
  // Keep the identifying part and drop the detail that grew.
  return JSON.stringify({
    surface: context.surface,
    factoryId: context.factoryId,
    workflow: context.workflow,
    selection: {
      nodeCount: input.selection.nodeCount,
      edgeCount: input.selection.edgeCount,
      truncated: true,
    },
    issueCount,
    ...(input.runId ? { runId: input.runId } : {}),
  });
}
