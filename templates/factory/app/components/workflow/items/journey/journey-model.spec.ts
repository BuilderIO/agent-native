import { describe, expect, it } from "vitest";

import type {
  ItemJourneyData,
  JourneyEvent,
  JourneyStep,
  PathNode,
} from "../read-types";
import {
  currentNodeId,
  groupEventsByRun,
  journeyAgentContext,
  journeyOverlay,
  lightPath,
} from "./journey-model";

function event(over: Partial<JourneyEvent>): JourneyEvent {
  return {
    id: "e",
    runId: "r1",
    at: "2026-10-18T09:00:00.000Z",
    kind: "entered",
    mode: "live",
    nodeId: null,
    nodeName: null,
    port: null,
    summary: "",
    summaryTruncated: false,
    receiptKey: null,
    threadId: null,
    outcome: null,
    code: null,
    ...over,
  };
}

function step(over: Partial<JourneyStep>): JourneyStep {
  return {
    runId: "r1",
    nodeId: "n1",
    nodeName: "Node",
    status: "succeeded",
    mode: "live",
    startedAt: "2026-10-18T09:00:00.000Z",
    finishedAt: "2026-10-18T09:00:01.000Z",
    ports: ["out"],
    portIdsTruncated: false,
    error: null,
    receiptKeys: [],
    agentThreadId: null,
    ...over,
  };
}

function pathNode(nodeId: string): PathNode {
  return {
    nodeId,
    nodeName: nodeId.toUpperCase(),
    nodeKind: "action",
    visits: 1,
    firstAt: "2026-10-18T09:00:00.000Z",
    lastAt: "2026-10-18T09:00:00.000Z",
  };
}

// source -> assess -(clear)-> reply -> end ; assess -(unclear)-> wait -> end
const graph = {
  nodes: [
    { id: "source" },
    { id: "assess" },
    { id: "reply" },
    { id: "wait" },
    { id: "end" },
  ],
  edges: [
    { id: "e1", from: { node: "source", port: "out" }, to: { node: "assess" } },
    {
      id: "e2",
      from: { node: "assess", port: "clear" },
      to: { node: "reply" },
    },
    {
      id: "e3",
      from: { node: "assess", port: "unclear" },
      to: { node: "wait" },
    },
    { id: "e4", from: { node: "reply", port: "out" }, to: { node: "end" } },
    { id: "e5", from: { node: "wait", port: "replied" }, to: { node: "end" } },
  ],
};

describe("groupEventsByRun", () => {
  it("groups neighbours of one run and starts a new group when the run changes", () => {
    const groups = groupEventsByRun([
      event({ id: "a", runId: "r1" }),
      event({ id: "b", runId: "r1", at: "2026-10-18T09:00:05.000Z" }),
      event({
        id: "c",
        runId: "r2",
        mode: "dry",
        at: "2026-10-18T09:40:00.000Z",
      }),
    ]);
    expect(groups.map((g) => [g.runId, g.events.length, g.mode])).toEqual([
      ["r1", 2, "live"],
      ["r2", 1, "dry"],
    ]);
    expect(groups[0]?.startedAt).toBe("2026-10-18T09:00:00.000Z");
  });

  it("returns no groups for no events", () => {
    expect(groupEventsByRun([])).toEqual([]);
  });
});

describe("lightPath", () => {
  const path = ["source", "assess", "wait", "end"].map(pathNode);
  const steps = [
    step({ nodeId: "source", ports: ["out"] }),
    step({ nodeId: "assess", ports: ["unclear"] }),
    step({ nodeId: "wait", ports: ["replied"] }),
    step({ nodeId: "end", ports: [] }),
  ];

  it("lights the connections the item left through, not every connection between visited steps", () => {
    const lit = lightPath(graph, path, steps);
    expect(lit.litNodeIds.sort()).toEqual(["assess", "end", "source", "wait"]);
    expect(lit.litEdgeIds.sort()).toEqual(["e1", "e3", "e5"]);
  });

  it("does not light a connection into a step the item never reached", () => {
    const lit = lightPath(graph, ["source", "assess"].map(pathNode), [
      step({ nodeId: "assess", ports: ["clear"] }),
    ]);
    expect(lit.litEdgeIds).toEqual(["e1"]);
  });

  it("lights every connection between visited steps when a step could not list its ports", () => {
    const lit = lightPath(graph, path, [
      step({ nodeId: "assess", ports: [], portIdsTruncated: true }),
      step({ nodeId: "source", ports: ["out"] }),
      step({ nodeId: "wait", ports: ["replied"] }),
    ]);
    expect(lit.litEdgeIds.sort()).toEqual(["e1", "e3", "e5"]);
  });

  it("does not read a Wait's parked count as a connection it left by", () => {
    const parkedAtWait = lightPath(
      graph,
      ["assess", "wait", "end"].map(pathNode),
      [
        step({ nodeId: "assess", ports: ["unclear"] }),
        step({ nodeId: "wait", ports: ["parked"] }),
      ],
    );
    // The item is still waiting: the connection out of the Wait stays dark.
    expect(parkedAtWait.litEdgeIds).toEqual(["e3"]);
  });

  it("drops a visited step the graph no longer has and counts it", () => {
    const lit = lightPath(graph, [...path, pathNode("removed")], steps);
    expect(lit.litNodeIds).not.toContain("removed");
    expect(lit.missingNodeCount).toBe(1);
  });
});

describe("journeyOverlay", () => {
  it("leaves the parked count off the ports it draws", () => {
    const { overlay } = journeyOverlay(graph, {
      path: ["wait"].map(pathNode),
      steps: [step({ nodeId: "wait", ports: ["parked"] })],
    });
    expect(overlay.stepByNodeId?.wait?.ports).toEqual({});
  });

  it("shows the newest step per node with one item through each port used", () => {
    const { overlay } = journeyOverlay(graph, {
      path: ["source", "assess"].map(pathNode),
      steps: [
        step({
          nodeId: "assess",
          status: "failed",
          startedAt: "2026-10-18T09:00:00.000Z",
          ports: [],
        }),
        step({
          nodeId: "assess",
          status: "succeeded",
          startedAt: "2026-10-18T09:41:00.000Z",
          ports: ["clear"],
        }),
      ],
    });
    expect(overlay.stepByNodeId?.assess).toEqual({
      status: "succeeded",
      ports: { clear: { count: 1 } },
    });
  });
});

describe("currentNodeId", () => {
  const state = (over: Record<string, unknown>) =>
    ({ parked: null, lastNode: null, ...over }) as ItemJourneyData["state"];
  const parked = {
    nodeId: "wait",
    nodeName: "wait",
    nodeMissingFromGraph: false,
    wait: "reply",
    dueAt: "2026-10-19T09:00:00.000Z",
    nextCheckAt: null,
    watching: null,
  };

  it("points at where the item waits before anything else", () => {
    expect(
      currentNodeId(
        {
          state: state({
            parked,
            lastNode: { nodeId: "assess", nodeName: "assess" },
          }),
          path: [],
        },
        graph,
      ),
    ).toBe("wait");
  });

  it("falls back to the last event's step, then to the last step reached", () => {
    expect(
      currentNodeId(
        {
          state: state({ lastNode: { nodeId: "assess", nodeName: "assess" } }),
          path: [],
        },
        graph,
      ),
    ).toBe("assess");
    const early = { ...pathNode("source"), lastAt: "2026-10-18T09:00:00.000Z" };
    const late = { ...pathNode("reply"), lastAt: "2026-10-18T09:05:00.000Z" };
    expect(currentNodeId({ state: null, path: [early, late] }, graph)).toBe(
      "reply",
    );
  });

  it("does not point at a step the graph no longer has", () => {
    expect(
      currentNodeId(
        {
          state: state({
            parked: { ...parked, nodeId: "gone", nodeMissingFromGraph: true },
          }),
          path: [pathNode("source")],
        },
        graph,
      ),
    ).toBe("source");
    expect(currentNodeId({ state: null, path: [] }, graph)).toBeNull();
  });
});

describe("journeyAgentContext", () => {
  const journey = {
    workflow: { id: "wf1", name: "Bug report to Builder", version: 3 },
    item: {
      id: "item-1",
      inbox: true,
      title: "x".repeat(500),
      source: "slack",
      sourceUrl: null,
      status: "needs_manual",
    },
    state: null,
    events: Array.from({ length: 10 }, (_, i) =>
      event({
        id: `e${i}`,
        kind: "error",
        code: "provider_error",
        nodeName: "Reply",
        summary: `provider_error: ${"y".repeat(400)}`,
      }),
    ),
    eventsHasMore: false,
    olderCursor: null,
    steps: [],
    path: Array.from({ length: 80 }, (_, i) => pathNode(`n${i}`)),
    receipts: [],
    receiptsTruncated: false,
  } as unknown as ItemJourneyData;

  it("hands the agent ids and a few clipped facts, not the whole journey", () => {
    const context = journeyAgentContext("f1", journey);
    const parsed = JSON.parse(context) as {
      itemId: string;
      title: string;
      path: string[];
      lastErrors: { summary: string }[];
    };
    expect(parsed.itemId).toBe("item-1");
    expect(parsed.title.length).toBeLessThanOrEqual(200);
    expect(parsed.path).toHaveLength(30);
    expect(parsed.lastErrors).toHaveLength(3);
    expect(parsed.lastErrors[0]?.summary.length).toBeLessThanOrEqual(200);
    expect(context.length).toBeLessThan(4000);
  });
});
