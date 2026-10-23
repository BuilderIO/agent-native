import { describe, expect, it } from "vitest";

import { buildGraph, rule } from "../story-graphs.fixture.js";
import {
  EVERY_5M,
  endWith,
  normalizedItem,
  providerQuery,
  sourceResult,
  startedByHand,
} from "../testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";
import { planGraph } from "./graph-order.js";
import { NODE_EXECUTORS } from "./nodes/registry.js";
import { createTickContext } from "./tick-context.js";
import type { FlowItem } from "./types.js";
import { walkGraph } from "./walker.js";

const graph = buildGraph({
  nodes: [
    ["start", "trigger", EVERY_5M],
    ["src", "source", providerQuery()],
    [
      "f",
      "filter",
      {
        combinator: "all",
        rules: [rule("item.extras.keep", "isTrue")],
      },
    ],
    ["hit", "end", endWith("done")],
    ["miss", "end", endWith("dismissed")],
  ],
  edges: [
    ["start", "out", "src"],
    ["src", "out", "f"],
    ["f", "match", "hit"],
    ["f", "otherwise", "miss"],
  ],
});

const flow = (id: string, keep: boolean): FlowItem => ({
  id,
  data: { title: id, extras: { keep } },
  nodes: {},
  inbox: true,
});

async function contextFor(mode: "live" | "dry" | "test" = "live") {
  const test = makeHost();
  const workflow = await seedWorkflow(test, graph);
  const { run } = await test.store.startRun(test.scope, {
    workflowId: workflow.id,
    tickKey: "tick-1",
    mode,
    ...startedByHand(mode),
    graphVersion: 1,
  });
  const ctx = createTickContext({
    host: test.host,
    scope: test.scope,
    workflowId: workflow.id,
    ownerEmail: "owner@example.test",
    graph,
    graphVersion: 1,
    run,
    mode,
    window: {
      start: "2026-10-19T11:55:00.000Z",
      end: "2026-10-19T12:00:00.000Z",
      firstRun: false,
    },
    scheduledFor: null,
  });
  return { test, ctx, plan: planGraph(graph) };
}

describe("walking from an arbitrary node", () => {
  it("runs only what is downstream of items injected at a node's output port", async () => {
    const { test, ctx, plan } = await contextFor();

    const result = await walkGraph(
      ctx,
      plan,
      [
        {
          kind: "output",
          nodeId: "src",
          itemsByPort: { out: [flow("woke-1", true), flow("woke-2", false)] },
        },
      ],
      { downstream: true },
    );

    expect(result.status).toBe("completed");
    expect(result.steps.map((step) => step.nodeId)).toEqual([
      "f",
      "hit",
      "miss",
    ]);
    expect(test.operations.calls).toHaveLength(0);
    expect(result.steps[0].ports.match.itemIds).toEqual(["woke-1"]);
    expect(result.steps[2].ports).toEqual({});
  });

  it("starts a node on items handed to its input", async () => {
    const { ctx, plan } = await contextFor();

    const result = await walkGraph(
      ctx,
      plan,
      [{ kind: "input", nodeId: "f", items: [flow("a", true)] }],
      { downstream: true },
    );

    expect(result.steps.map((step) => step.nodeId)).toEqual([
      "f",
      "hit",
      "miss",
    ]);
    expect(result.steps[1].fields).toMatchObject({ in: 1 });
  });

  it("lets resumed items and new items meet at the same node, once", async () => {
    const { test, ctx, plan } = await contextFor();
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("new-1", { extras: { keep: true } })]),
    );

    const result = await walkGraph(
      ctx,
      plan,
      [
        { kind: "input", nodeId: "start", items: [] },
        {
          kind: "output",
          nodeId: "src",
          itemsByPort: { out: [flow("woke-1", true)] },
        },
      ],
      { downstream: true },
    );

    const filter = result.steps.filter((step) => step.nodeId === "f");
    expect(filter).toHaveLength(1);
    expect(filter[0].ports.match.itemIds).toEqual(["woke-1", "new-1"]);
  });

  it("runs only the seeded node when told not to go downstream", async () => {
    const { ctx, plan } = await contextFor("test");

    const result = await walkGraph(
      ctx,
      plan,
      [{ kind: "input", nodeId: "f", items: [flow("a", true)] }],
      { downstream: false },
    );

    expect(result.steps.map((step) => step.nodeId)).toEqual(["f"]);
  });

  it("records the nodes it did not reach when the node before them failed", async () => {
    const { test, ctx, plan } = await contextFor();
    test.operations.script("test.items", { ok: true, output: null });

    const result = await walkGraph(
      ctx,
      plan,
      [{ kind: "input", nodeId: "start", items: [] }],
      { downstream: true },
    );

    expect(result.status).toBe("failed");
    expect(result.steps.map((step) => [step.nodeId, step.status])).toEqual([
      ["start", "succeeded"],
      ["src", "failed"],
      ["f", "skipped"],
      ["hit", "skipped"],
      ["miss", "skipped"],
    ]);
  });

  it("stops the run loudly when a node sends items out of a port it does not have", async () => {
    const { ctx, plan } = await contextFor();
    const original = NODE_EXECUTORS.filter;
    NODE_EXECUTORS.filter = async () => ({
      itemsByPort: { bogus: [flow("lost", true)] },
    });
    try {
      await expect(
        walkGraph(
          ctx,
          plan,
          [{ kind: "input", nodeId: "f", items: [flow("a", true)] }],
          { downstream: true },
        ),
      ).rejects.toThrow(/does not have/);
    } finally {
      NODE_EXECUTORS.filter = original;
    }
  });
});
