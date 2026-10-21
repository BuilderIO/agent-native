import type { WorkflowGraph, WorkflowIssue } from "@/lib/workflow-editor";

import type { WorkflowCanvasStrings } from "../workflow-canvas/strings";
import type { ServerIssue } from "./workflow-errors";
import type { WorkflowStrings } from "./workflow-strings";

/** One line in the problems list: what is wrong, where, and what to select to see it. */
export interface ProblemRow {
  key: string;
  sentence: string;
  /** The step or connection it is about, in words. */
  where?: string;
  nodeId?: string;
  edgeId?: string;
}

/** The canvas's sentence for a problem; a code it has no sentence for is shown as the validator worded it. */
function sentenceFor(issue: WorkflowIssue, s: WorkflowCanvasStrings): string {
  const sentence = s.issue.sentence(
    issue,
    issue.port ? s.port[issue.port] : undefined,
  );
  return sentence ?? issue.detail ?? issue.code;
}

function nodeNames(graph: WorkflowGraph): Map<string, string> {
  return new Map(graph.nodes.map((node) => [node.id, node.name]));
}

function describeEdge(
  graph: WorkflowGraph,
  edgeId: string,
  names: Map<string, string>,
  s: WorkflowCanvasStrings,
): string | undefined {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return undefined;
  const from = names.get(edge.from.node) ?? edge.from.node;
  const to = names.get(edge.to.node) ?? edge.to.node;
  return s.issue.edge(from, to);
}

function sameProblem(local: WorkflowIssue, server: ServerIssue): boolean {
  return (
    local.code === server.code &&
    local.nodeId === server.nodeId &&
    local.edgeId === server.edgeId &&
    local.port === server.port
  );
}

/**
 * The editor's own checks, plus whatever the last refused save added that the
 * editor cannot see (a schedule that needs a time zone, a field the schema
 * rejects). A problem both found is listed once.
 */
export function listProblems(input: {
  graph: WorkflowGraph;
  issues: readonly WorkflowIssue[];
  serverIssues: readonly ServerIssue[];
  strings: { canvas: WorkflowCanvasStrings; workflow: WorkflowStrings };
}): ProblemRow[] {
  const { canvas, workflow: ws } = input.strings;
  const names = nodeNames(input.graph);
  const rows: ProblemRow[] = input.issues.map((issue, index) => ({
    key: `local:${index}`,
    sentence: sentenceFor(issue, canvas),
    ...(issue.nodeId
      ? { nodeId: issue.nodeId, where: names.get(issue.nodeId) }
      : {}),
    ...(issue.edgeId
      ? {
          edgeId: issue.edgeId,
          where: describeEdge(input.graph, issue.edgeId, names, canvas),
        }
      : {}),
  }));

  input.serverIssues.forEach((issue, index) => {
    if (input.issues.some((local) => sameProblem(local, issue))) return;
    const detail = issue.detail ?? issue.code;
    rows.push({
      key: `server:${index}`,
      sentence:
        issue.source === "schema"
          ? ws.save.serverIssue(issue.path ?? "", detail)
          : issue.source === "graph"
            ? sentenceFor(
                {
                  ...issue,
                  code: issue.code as WorkflowIssue["code"],
                },
                canvas,
              )
            : detail,
      ...(issue.nodeId
        ? { nodeId: issue.nodeId, where: names.get(issue.nodeId) }
        : {}),
      ...(issue.edgeId
        ? {
            edgeId: issue.edgeId,
            where: describeEdge(input.graph, issue.edgeId, names, canvas),
          }
        : {}),
    });
  });
  return rows;
}
