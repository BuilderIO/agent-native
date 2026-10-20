import { portLabel } from "@/components/workflow-canvas/flow-model";
import type { WorkflowCanvasStrings } from "@/components/workflow-canvas/strings";
import type { WorkflowNode } from "@/lib/workflow-editor";

import type { ItemsStrings } from "../items-strings";

/**
 * A Wait's step lists how many items it parked under this name. It is a count
 * for the step, not an output with a connection: no edge leaves by it.
 */
export const PARKED_PORT = "parked";

export type PortLabeler = (nodeId: string, port: string) => string;

/**
 * Names a step's output the way the canvas does: a Switch route by the label
 * its author gave it, a plain port by its common name. With no graph, or a
 * step the graph no longer has, the port is shown as recorded minus the
 * `route:` prefix, never blank.
 */
export function portLabeler(
  graph: { nodes: readonly WorkflowNode[] } | undefined,
  s: ItemsStrings,
  canvas: WorkflowCanvasStrings,
): PortLabeler {
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  return (nodeId, port) => {
    if (port === PARKED_PORT) return s.audit.parkedCount;
    const node = nodes.get(nodeId);
    return node ? portLabel(node, port, canvas) : port.replace(/^route:/, "");
  };
}
