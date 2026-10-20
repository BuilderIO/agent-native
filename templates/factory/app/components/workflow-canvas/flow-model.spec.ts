import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import { validateEditorGraph, type WorkflowGraph } from "@/lib/workflow-editor";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import { STORY_GRAPHS } from "../../../server/workflow/story-graphs.fixture.js";
import {
  TARGET_HANDLE,
  portLabel,
  reconcileNodes,
  toFlowEdges,
  toFlowNodes,
} from "./flow-model";
import type { WorkflowOverlay } from "./overlay";
import { createWorkflowCanvasStrings } from "./strings";

const graph = STORY_GRAPHS["bug-report-to-builder"];
const validation = validateEditorGraph(graph, OPERATION_CATALOG);
const selection = { nodeIds: [], edgeIds: [] };
const strings = createWorkflowCanvasStrings(createEnglishTranslator());

function nodes(overrides: Partial<Parameters<typeof toFlowNodes>[0]> = {}) {
  return toFlowNodes({
    graph,
    catalog: OPERATION_CATALOG,
    validation,
    selection,
    readOnly: false,
    strings,
    ...overrides,
  });
}

describe("toFlowNodes", () => {
  it("makes one flow node per graph node, in place", () => {
    const flow = nodes();
    expect(flow.map((node) => node.id)).toEqual(graph.nodes.map((n) => n.id));
    expect(flow[1].position).toEqual(graph.nodes[1].position);
    expect(flow.every((node) => node.type === "workflow")).toBe(true);
  });

  it("gives a switch one labelled port per route, then otherwise", () => {
    const route = nodes().find((node) => node.id === "route")!;
    expect(route.data.ports.map((port) => port.label)).toEqual([
      "Already claimed by a person",
      "Needs info",
      "Not a bug",
      "Clear and safe",
      "Otherwise",
    ]);
    expect(route.data.showPortRows).toBe(true);
  });

  it("shows a wait's outputs, with limitReached once a loop leaves it", () => {
    const wait = nodes().find((node) => node.id === "waitReply")!;
    expect(wait.data.ports.map((port) => port.id)).toEqual([
      "replied",
      "timedOut",
      "limitReached",
    ]);
    expect(wait.data.ports.map((port) => port.label)).toEqual([
      "Replied",
      "Timed out",
      "Limit reached",
    ]);
  });

  it("gives a node with one plain output no port rows", () => {
    const lookup = nodes().find((node) => node.id === "thread")!;
    expect(lookup.data.showPortRows).toBe(false);
    expect(lookup.data.subtitle).toBe("Slack: read a thread");
  });

  it("marks selected nodes and makes everything read-only when asked", () => {
    const flow = nodes({
      selection: { nodeIds: ["route"], edgeIds: [] },
      readOnly: true,
    });
    expect(flow.filter((node) => node.selected).map((n) => n.id)).toEqual([
      "route",
    ]);
    expect(flow.every((node) => node.draggable === false)).toBe(true);
    expect(flow.every((node) => node.connectable === false)).toBe(true);
  });

  it("carries step status and per-port counts from the overlay", () => {
    const overlay: WorkflowOverlay = {
      stepByNodeId: {
        route: {
          status: "succeeded",
          ports: { "route:needsInfo": { count: 4 }, otherwise: { count: 0 } },
        },
      },
    };
    const route = nodes({ overlay }).find((node) => node.id === "route")!;
    expect(route.data.step?.status).toBe("succeeded");
    const counts = Object.fromEntries(
      route.data.ports.map((port) => [port.id, port.count]),
    );
    expect(counts["route:needsInfo"]).toBe(4);
    expect(counts.otherwise).toBe(0);
    expect(counts["route:notBug"]).toBeUndefined();
  });

  it("lights the given nodes and fades the rest, but only when told which are lit", () => {
    const plain = nodes();
    expect(plain.every((node) => node.data.state === "default")).toBe(true);
    const lit = nodes({
      overlay: { litNodeIds: ["every5", "feedback"], litEdgeIds: [] },
    });
    expect(lit.find((n) => n.id === "every5")?.data.state).toBe("lit");
    expect(lit.find((n) => n.id === "route")?.data.state).toBe("dimmed");
  });

  it("puts a node's issues, and an unconnected output's, on the node", () => {
    const broken: WorkflowGraph = {
      ...graph,
      edges: graph.edges.filter(
        (edge) =>
          !(edge.from.node === "route" && edge.from.port === "otherwise"),
      ),
    };
    const flow = toFlowNodes({
      graph: broken,
      catalog: OPERATION_CATALOG,
      validation: validateEditorGraph(broken, OPERATION_CATALOG),
      selection,
      readOnly: false,
      strings,
    });
    const route = flow.find((node) => node.id === "route")!;
    expect(route.data.issues.map((issue) => issue.code)).toContain(
      "port_leads_nowhere",
    );
    const otherwise = route.data.ports.find((port) => port.id === "otherwise")!;
    expect(otherwise.connected).toBe(false);
    expect(otherwise.issues).toHaveLength(1);
  });
});

describe("toFlowEdges", () => {
  const edges = toFlowEdges({ graph, validation, selection });

  it("draws forward edges and the loop's back-edge differently", () => {
    expect(edges).toHaveLength(graph.edges.length);
    const back = edges.filter((edge) => edge.type === "back");
    expect(back).toHaveLength(1);
    expect(back[0].data?.edge.back?.maxIterations).toBe(1);
    expect(edges.filter((edge) => edge.type === "forward")).toHaveLength(
      graph.edges.length - 1,
    );
  });

  it("joins a port to the target's one input", () => {
    const edge = edges.find((candidate) => candidate.id === "e5")!;
    expect(edge.sourceHandle).toBe("route:needsInfo");
    expect(edge.targetHandle).toBe(TARGET_HANDLE);
  });

  it("shows a count on an edge only where the source has no labelled outputs", () => {
    const overlay: WorkflowOverlay = {
      stepByNodeId: {
        thread: { status: "succeeded", ports: { out: { count: 7 } } },
        route: {
          status: "succeeded",
          ports: { "route:needsInfo": { count: 3 } },
        },
      },
    };
    const withCounts = toFlowEdges({ graph, validation, selection, overlay });
    const fromThread = withCounts.find((edge) => edge.source === "thread")!;
    const fromRoute = withCounts.find(
      (edge) => edge.sourceHandle === "route:needsInfo",
    )!;
    expect(fromThread.data?.count).toBe(7);
    expect(fromRoute.data?.count).toBeUndefined();
  });

  it("leaves out an edge whose output no longer exists and shows its problem on the steps", () => {
    const dangling: WorkflowGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: "stray",
          from: { node: "thread", port: "match" },
          to: { node: "assess" },
        },
      ],
    };
    const check = validateEditorGraph(dangling, OPERATION_CATALOG);
    const drawn = toFlowEdges({
      graph: dangling,
      validation: check,
      selection,
    });
    expect(drawn.some((edge) => edge.id === "stray")).toBe(false);
    const flow = toFlowNodes({
      graph: dangling,
      catalog: OPERATION_CATALOG,
      validation: check,
      selection,
      readOnly: false,
      strings,
    });
    expect(
      flow
        .find((node) => node.id === "thread")!
        .data.issues.map((issue) => issue.code),
    ).toContain("edge_unknown_port");
  });

  it("selects and lights edges by id", () => {
    const picked = toFlowEdges({
      graph,
      validation,
      selection: { nodeIds: [], edgeIds: ["e1"] },
      overlay: { litNodeIds: [], litEdgeIds: ["e2"] },
    });
    expect(picked.find((edge) => edge.id === "e1")?.selected).toBe(true);
    expect(picked.find((edge) => edge.id === "e2")?.data?.state).toBe("lit");
    expect(picked.find((edge) => edge.id === "e3")?.data?.state).toBe("dimmed");
  });
});

describe("portLabel", () => {
  it("falls back to the port id for a name it does not know", () => {
    const node = graph.nodes[0];
    expect(portLabel(node, "mystery", strings)).toBe("mystery");
  });
});

describe("reconcileNodes", () => {
  it("keeps measured sizes and a dragged node's position", () => {
    const [first, second] = nodes();
    const previous = [
      { ...first, measured: { width: 248, height: 56 } },
      { ...second, dragging: true, position: { x: 999, y: 999 } },
    ];
    const next = nodes();
    const merged = reconcileNodes(previous, next);
    expect(merged[0].measured).toEqual({ width: 248, height: 56 });
    expect(merged[0].position).toEqual(next[0].position);
    expect(merged[1].position).toEqual({ x: 999, y: 999 });
    expect(merged[2]).toBe(next[2]);
  });
});
