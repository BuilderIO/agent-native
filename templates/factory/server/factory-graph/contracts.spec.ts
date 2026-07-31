import { describe, expect, it } from "vitest";

import { defaultFactoryGraph, normalizeFactoryGraph } from "./contracts.js";

describe("Factory graph contract", () => {
  it("ships a connected default feedback-to-delivery graph", () => {
    const graph = defaultFactoryGraph();

    expect(graph.nodes.length).toBeGreaterThan(5);
    expect(graph.edges.length).toBeGreaterThan(4);
    expect(graph.executionMode).toBe("blueprint");
    expect(
      graph.nodes.find((node) => node.id === "ai-triage")?.label,
    ).toContain("parallel");
    expect(
      graph.edges.find((edge) => edge.id === "human-to-agent")?.source,
    ).toBe("human-gate");
    expect(() => normalizeFactoryGraph(graph)).not.toThrow();
    expect(graph.edges.every((edge) => edge.source !== edge.target)).toBe(true);
  });

  it("rejects routes that point at missing nodes", () => {
    const graph = defaultFactoryGraph();

    expect(() =>
      normalizeFactoryGraph({
        ...graph,
        edges: [
          ...graph.edges,
          {
            id: "bad-route",
            source: "missing",
            target: graph.nodes[0]?.id,
            label: "bad",
            condition: "",
          },
        ],
      }),
    ).toThrow("references a missing node");
  });

  it("rejects duplicate node ids", () => {
    const graph = defaultFactoryGraph();
    const first = graph.nodes[0];

    expect(first).toBeDefined();
    expect(() =>
      normalizeFactoryGraph({
        ...graph,
        nodes: [...graph.nodes, { ...first! }],
      }),
    ).toThrow("duplicate node id");
  });
});
