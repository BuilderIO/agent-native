import {
  createWorkflowEditor,
  workflowGraphSchema,
  type WorkflowGraph,
} from "@/lib/workflow-editor";

import { WORKFLOW_CATALOG } from "./workflow-catalog";

/**
 * The smallest graph a save accepts: a trigger that runs every 15 minutes,
 * leading to an end. A trigger alone is refused, because its output would
 * lead nowhere. The author builds from here.
 */
export function minimalWorkflowGraph(): WorkflowGraph {
  const editor = createWorkflowEditor({
    graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
    catalog: WORKFLOW_CATALOG,
  });
  const trigger = editor.addNode("trigger");
  if (!trigger.ok) {
    throw new Error(`Could not add the first step: ${trigger.rejection.code}`);
  }
  const end = editor.addNode("end", {
    after: { node: trigger.node.id, port: "out" },
  });
  if (!end.ok) {
    throw new Error(`Could not add the last step: ${end.rejection.code}`);
  }
  return editor.getSnapshot().graph;
}

// Held in memory, not storage: a reload before the canvas loads drops the
// request, and the workflow is still there to ask again.
const heldRequests = new Map<string, string>();

/** Keeps a request from the New workflow dialog until its canvas opens. */
export function holdNewWorkflowRequest(
  workflowId: string,
  request: string,
): void {
  heldRequests.set(workflowId, request);
}

/** The held request for a workflow, handed out once: the canvas that takes it sends it. */
export function takeNewWorkflowRequest(workflowId: string): string | null {
  const request = heldRequests.get(workflowId) ?? null;
  heldRequests.delete(workflowId);
  return request;
}

/** The message the agent gets for a request: the canvas's describe prefix, then the request. */
export function newWorkflowAgentMessage(
  prefix: string,
  request: string,
): string {
  return `${prefix}${request.trim()}`;
}

const MAX_NAME_CHARS = 80;

/**
 * A workflow made from a prompt is named after it: one line, at most 80
 * characters. The name cannot change after save, and the server refuses a line break.
 */
export function workflowNameFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return [...oneLine].slice(0, MAX_NAME_CHARS).join("").trimEnd();
}
