import {
  validateWorkflowGraph,
  type WorkflowGraph,
  type WorkflowIssue,
} from "./engine.js";
import type { EditorValidation, WorkflowCatalog } from "./types.js";

/** The validator's issues, filed under the node and edge each one names. */
export function validateEditorGraph(
  graph: WorkflowGraph,
  catalog: WorkflowCatalog,
): EditorValidation {
  const { ok, issues } = validateWorkflowGraph(graph, catalog);
  const byNode: Record<string, WorkflowIssue[]> = {};
  const byEdge: Record<string, WorkflowIssue[]> = {};
  const graphLevel: WorkflowIssue[] = [];
  for (const issue of issues) {
    if (issue.nodeId !== undefined) {
      (byNode[issue.nodeId] ??= []).push(issue);
    }
    if (issue.edgeId !== undefined) {
      (byEdge[issue.edgeId] ??= []).push(issue);
    }
    if (issue.nodeId === undefined && issue.edgeId === undefined) {
      graphLevel.push(issue);
    }
  }
  return { ok, issues, byNode, byEdge, graphLevel };
}
