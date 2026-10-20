import { describe, expect, it } from "vitest";

import { WorkflowError } from "../contract.js";
import { STORY_GRAPHS, buildGraph } from "../story-graphs.fixture.js";
import {
  EVERY_5M,
  endWith,
  providerQuery,
} from "../testing/engine-fixtures.js";
import { loopsOf, planGraph } from "./graph-order.js";

describe("planGraph", () => {
  it("orders nodes upstream before downstream, ties by the order they are listed", () => {
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["b", "source", providerQuery()],
        ["a", "source", providerQuery()],
        ["join", "combine", { mode: "count" }],
        ["done", "end", endWith("done")],
      ],
      edges: [
        ["start", "out", "b"],
        ["start", "out", "a"],
        ["b", "out", "join"],
        ["a", "out", "join"],
        ["join", "out", "done"],
      ],
    });

    expect(planGraph(graph).order).toEqual(["start", "b", "a", "join", "done"]);
  });

  it("orders every story that has no back-edge, and leaves a back-edge out of the order", () => {
    for (const graph of Object.values(STORY_GRAPHS)) {
      const plan = planGraph(graph);
      expect(plan.order).toHaveLength(graph.nodes.length);
      const position = new Map(plan.order.map((id, index) => [id, index]));
      for (const edge of graph.edges.filter((entry) => !entry.back)) {
        expect(position.get(edge.from.node)).toBeLessThan(
          position.get(edge.to.node) ?? -1,
        );
      }
    }
  });

  it("fails on a cycle that is not a loop back-edge instead of looping", () => {
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["a", "combine", { mode: "count" }],
        ["b", "combine", { mode: "count" }],
      ],
      edges: [
        ["start", "out", "a"],
        ["a", "out", "b"],
        ["b", "out", "a"],
      ],
    });

    expect(() => planGraph(graph)).toThrow(WorkflowError);
    expect(() => planGraph(graph)).toThrow(/cycle/);
  });
});

describe("loopsOf", () => {
  it("names the back-edge, where it returns to, and the nodes one pass runs through", () => {
    const graph = STORY_GRAPHS["bug-report-to-builder"];

    const [loop, ...rest] = loopsOf(graph);

    expect(rest).toEqual([]);
    expect(loop).toMatchObject({
      head: "thread",
      tail: "waitReply",
      max: 1,
    });
    expect([...loop.body].sort()).toEqual([
      "ask",
      "assess",
      "route",
      "thread",
      "waitReply",
    ]);
  });

  it("keeps the back-edges out of the plan's forward edges, and lists them by the node they leave", () => {
    const graph = STORY_GRAPHS["bug-report-to-builder"];
    const plan = planGraph(graph);

    expect(
      plan.backEdges.get("waitReply")?.map((edge) => edge.to.node),
    ).toEqual(["thread"]);
    expect(
      (plan.outgoing.get("waitReply") ?? []).map((edge) => edge.from.port),
    ).toEqual(["timedOut", "limitReached"]);
  });

  it("finds no loop in a graph without a back-edge", () => {
    expect(loopsOf(STORY_GRAPHS["morning-digest"])).toEqual([]);
  });
});
