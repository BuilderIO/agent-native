import { describe, expect, it } from "vitest";

import { buildGraph, rule } from "../../story-graphs.fixture.js";
import {
  EVERY_5M,
  endWith,
  eventsOf,
  normalizedItem,
  providerQuery,
  ran,
  sourceResult,
  stepOf,
  T0,
} from "../../testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const scored = (id: string, score: unknown) =>
  normalizedItem(id, { extras: { score } });

describe("a filter", () => {
  const filterGraph = (rules = [rule("item.extras.score", "gt", 5)]) =>
    buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["src", "source", providerQuery()],
        ["f", "filter", { combinator: "all", rules }],
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

  async function setup(rules?: ReturnType<typeof rule>[]) {
    const test = makeHost();
    const { id } = await seedWorkflow(test, filterGraph(rules));
    return { test, id };
  }

  it("sends each item to Match or Otherwise and says which, with the ports counted on the step", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult([scored("a", 9), scored("b", 1), scored("c", 6)]),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "f");
    expect(step.ports.match).toEqual({ count: 2, itemIds: ["a", "c"] });
    expect(step.ports.otherwise).toEqual({ count: 1, itemIds: ["b"] });
    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "a", status: "resolved" }),
      expect.objectContaining({ itemId: "c", status: "resolved" }),
      expect.objectContaining({ itemId: "b", status: "dismissed" }),
    ]);
    expect(
      (await eventsOf(test, id, "b")).find(
        (event) => event.kind === "decision",
      ),
    ).toMatchObject({
      nodeId: "f",
      port: "otherwise",
      summary: "did not match",
    });
  });

  it("fails an item whose rule cannot be answered, rather than counting it as no match", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult([scored("a", 9), scored("b", "high"), normalizedItem("c")]),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "f");
    expect(step.ports.match.itemIds).toEqual(["a"]);
    expect(step.ports.otherwise.count).toBe(0);
    expect(step.status).toBe("failed");
    expect(step.error?.code).toBe("expression_failed");
    expect(result.run.counts.itemFailures).toBe(2);
    // The two it could not answer are with a person; the one that matched went on to its End.
    expect(test.statuses.statusOf("a")).toBe("resolved");
    expect(test.statuses.statusOf("b")).toBe("needs_manual");
    expect(test.statuses.statusOf("c")).toBe("needs_manual");
    expect(
      (await test.store.getItemState(test.scope, id, "c"))?.counters,
    ).toEqual({
      attempts: 1,
    });
  });

  it("reads the engine's attempt counter as item.attempts, for an item that failed there and is back for another try", async () => {
    const { test, id } = await setup([rule("item.attempts", "lt", 1)]);
    test.operations.always("test.items", sourceResult([]));
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "earlier",
      now: T0,
    });
    await test.store.parkItem(test.scope, {
      workflowId: id,
      itemId: "a",
      leasedBy: "earlier",
      graphVersion: 1,
      nodeId: "f",
      wake: { wait: "retry", dueAt: T0 },
      context: {
        data: { ...normalizedItem("a") },
        nodes: {},
        inbox: true,
        waitSince: T0,
        kept: ["item"],
        retryKind: "filter",
      },
      counters: { attempts: 1 },
    });

    const result = await ran(test, id);

    expect(stepOf(result, "f").ports.otherwise.itemIds).toEqual(["a"]);
  });

  it("no longer counts the attempts of an item that has come through the node it failed at", async () => {
    const { test, id } = await setup([rule("item.attempts", "lt", 1)]);
    test.operations.always("test.items", sourceResult([normalizedItem("a")]));
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "earlier",
      now: "2026-10-19T10:00:00.000Z",
      ttlMs: 1000,
    });
    await test.store.incrementCounter(test.scope, {
      workflowId: id,
      itemId: "a",
      counter: "attempts",
    });

    const result = await ran(test, id);

    // Taken afresh, it is not an item that failed: what happened to it before is behind it.
    expect(stepOf(result, "f").ports.match.itemIds).toEqual(["a"]);
  });
});

describe("a switch", () => {
  const switchGraph = () =>
    buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["src", "source", providerQuery()],
        [
          "route",
          "switch",
          {
            routes: [
              {
                id: "big",
                label: "Big",
                combinator: "all",
                rules: [rule("item.extras.score", "gt", 8)],
              },
              {
                id: "medium",
                label: "Medium",
                combinator: "all",
                rules: [rule("item.extras.score", "gt", 4)],
              },
            ],
          },
        ],
        ["bigEnd", "end", endWith("done")],
        ["mediumEnd", "end", endWith("released")],
        ["otherEnd", "end", endWith("dismissed")],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "route"],
        ["route", "route:big", "bigEnd"],
        ["route", "route:medium", "mediumEnd"],
        ["route", "otherwise", "otherEnd"],
      ],
    });

  it("sends an item down the first route it meets, or Otherwise", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, switchGraph());
    test.operations.script(
      "test.items",
      sourceResult([scored("a", 9), scored("b", 6), scored("c", 1)]),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "route");
    expect(step.ports).toEqual({
      "route:big": { count: 1, itemIds: ["a"] },
      "route:medium": { count: 1, itemIds: ["b"] },
      otherwise: { count: 1, itemIds: ["c"] },
    });
    expect(
      (await eventsOf(test, id, "b")).find(
        (event) => event.kind === "decision",
      ),
    ).toMatchObject({
      port: "route:medium",
      summary: "route: Medium",
    });
  });

  it("reads every route for every item, so a broken later route fails an item an earlier route caught", async () => {
    const test = makeHost();
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["src", "source", providerQuery()],
        [
          "route",
          "switch",
          {
            routes: [
              {
                id: "first",
                label: "First",
                combinator: "all",
                rules: [rule("item.extras.score", "gt", 0)],
              },
              {
                id: "second",
                label: "Second",
                combinator: "all",
                rules: [rule("item.extras.missing", "isTrue")],
              },
            ],
          },
        ],
        ["firstEnd", "end", endWith("done")],
        ["secondEnd", "end", endWith("done")],
        ["otherEnd", "end", endWith("dismissed")],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "route"],
        ["route", "route:first", "firstEnd"],
        ["route", "route:second", "secondEnd"],
        ["route", "otherwise", "otherEnd"],
      ],
    });
    const { id } = await seedWorkflow(test, graph);
    test.operations.script("test.items", sourceResult([scored("a", 9)]));

    const result = await ran(test, id);

    const step = stepOf(result, "route");
    expect(step.ports["route:first"].count).toBe(0);
    expect(step.error).toMatchObject({
      code: "expression_failed",
      message: expect.stringContaining('route "second"'),
    });
  });
});
