import type { WorkflowOverlay } from "@/components/workflow-canvas";

import { PARKED_PORT } from "../port-label";
import type {
  ItemJourneyData,
  JourneyEvent,
  JourneyStep,
  PathNode,
  ReceiptView,
  RunMode,
} from "../read-types";

export interface RunGroup {
  runId: string;
  mode: RunMode;
  /** The first event of the run on this page. */
  startedAt: string;
  events: JourneyEvent[];
}

/**
 * Events come oldest first, so one run is a run of neighbours. A run split by
 * a page boundary is two groups, one per page.
 */
export function groupEventsByRun(events: readonly JourneyEvent[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.runId === event.runId) {
      last.events.push(event);
    } else {
      groups.push({
        runId: event.runId,
        mode: event.mode,
        startedAt: event.at,
        events: [event],
      });
    }
  }
  return groups;
}

interface GraphShape {
  nodes: readonly { id: string }[];
  edges: readonly {
    id: string;
    from: { node: string; port: string };
    to: { node: string };
  }[];
}

interface PathLighting {
  litNodeIds: string[];
  litEdgeIds: string[];
  /** Visited steps whose node the graph no longer has. */
  missingNodeCount: number;
}

/**
 * What the canvas lights for one item: the steps it reached, and the
 * connections it actually left through. An edge is lit when the item left its
 * source step by that port and then reached the target; a source step that
 * could not list every port it used lights every connection to a visited step.
 */
export function lightPath(
  graph: GraphShape,
  path: readonly PathNode[],
  steps: readonly JourneyStep[],
): PathLighting {
  const present = new Set(graph.nodes.map((node) => node.id));
  const visited = new Set(
    path.map((node) => node.nodeId).filter((id) => present.has(id)),
  );
  const leftBy = new Map<string, { ports: Set<string>; complete: boolean }>();
  for (const step of steps) {
    const entry = leftBy.get(step.nodeId) ?? {
      ports: new Set<string>(),
      complete: true,
    };
    for (const port of step.ports) {
      if (port !== PARKED_PORT) entry.ports.add(port);
    }
    if (step.portIdsTruncated) entry.complete = false;
    leftBy.set(step.nodeId, entry);
  }
  const litEdgeIds = graph.edges
    .filter((edge) => {
      if (!visited.has(edge.from.node) || !visited.has(edge.to.node)) {
        return false;
      }
      const left = leftBy.get(edge.from.node);
      return left ? !left.complete || left.ports.has(edge.from.port) : true;
    })
    .map((edge) => edge.id);
  return {
    litNodeIds: [...visited],
    litEdgeIds,
    missingNodeCount: path.filter((node) => !present.has(node.nodeId)).length,
  };
}

/** The newest step the item had at each node, with one item through each port it used. */
export function journeyOverlay(
  graph: GraphShape,
  journey: Pick<ItemJourneyData, "path" | "steps">,
): { overlay: WorkflowOverlay; missingNodeCount: number } {
  const lit = lightPath(graph, journey.path, journey.steps);
  const latest = new Map<string, JourneyStep>();
  for (const step of journey.steps) {
    const current = latest.get(step.nodeId);
    if (
      !current ||
      Date.parse(step.startedAt) >= Date.parse(current.startedAt)
    ) {
      latest.set(step.nodeId, step);
    }
  }
  const stepByNodeId: NonNullable<WorkflowOverlay["stepByNodeId"]> = {};
  for (const [nodeId, step] of latest) {
    stepByNodeId[nodeId] = {
      status: step.status,
      ports: Object.fromEntries(
        step.ports
          .filter((port) => port !== PARKED_PORT)
          .map((port) => [port, { count: 1 }]),
      ),
    };
  }
  return {
    overlay: {
      stepByNodeId,
      litNodeIds: lit.litNodeIds,
      litEdgeIds: lit.litEdgeIds,
    },
    missingNodeCount: lit.missingNodeCount,
  };
}

/**
 * The step to bring into view when a journey opens: where the item waits, else
 * the step of its last event, else the last step it reached. A step the graph
 * no longer has is no place to point at.
 */
export function currentNodeId(
  journey: Pick<ItemJourneyData, "state" | "path">,
  graph: GraphShape,
): string | null {
  const present = new Set(graph.nodes.map((node) => node.id));
  const parked = journey.state?.parked;
  const lastEvent = journey.state?.lastNode?.nodeId;
  const lastReached = [...journey.path]
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .find((node) => present.has(node.nodeId))?.nodeId;
  const candidates = [
    parked && !parked.nodeMissingFromGraph ? parked.nodeId : undefined,
    lastEvent,
    lastReached,
  ];
  return candidates.find((id) => id !== undefined && present.has(id)) ?? null;
}

export function receiptsByKey(
  receipts: readonly ReceiptView[],
): Map<string, ReceiptView> {
  return new Map(receipts.map((receipt) => [receipt.key, receipt]));
}

const AGENT_TEXT_CHARS = 200;
const AGENT_PATH_NODES = 30;
const AGENT_ERRORS = 3;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * What the agent is told about the item it is asked about: ids to read the
 * rest from, and a few clipped facts to start from. Never the whole journey.
 */
export function journeyAgentContext(
  factoryId: string,
  journey: ItemJourneyData,
): string {
  const errors = journey.events
    .filter((event) => event.kind === "error")
    .slice(-AGENT_ERRORS)
    .map((event) => ({
      node: event.nodeName ?? event.nodeId,
      at: event.at,
      code: event.code,
      summary: clip(event.summary, AGENT_TEXT_CHARS),
    }));
  const parked = journey.state?.parked ?? null;
  return JSON.stringify({
    view: "item-journey",
    factoryId,
    workflowId: journey.workflow.id,
    workflowName: clip(journey.workflow.name, AGENT_TEXT_CHARS),
    itemId: journey.item.id,
    title: journey.item.title
      ? clip(journey.item.title, AGENT_TEXT_CHARS)
      : null,
    source: journey.item.source,
    status: journey.item.status,
    needsYou: journey.state?.needsYouReasons ?? [],
    parked: parked
      ? {
          node: parked.nodeName ?? parked.nodeId,
          wait: parked.wait,
          dueAt: parked.dueAt,
        }
      : null,
    path: journey.path
      .slice(0, AGENT_PATH_NODES)
      .map((node) => node.nodeName ?? node.nodeId),
    lastErrors: errors,
    receipts: journey.receipts.length,
  });
}
