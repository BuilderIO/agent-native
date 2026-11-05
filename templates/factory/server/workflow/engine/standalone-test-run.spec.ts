import { describe, expect, it } from "vitest";

import { chain, eventsOf, ran, stepOf } from "../testing/engine-fixtures.js";
import { ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const readFixed = [
  "read",
  "lookup",
  {
    operation: "test.read",
    args: { key: { mode: "fixed", value: "static" } },
  },
] as const;

const readItem = [
  "read",
  "lookup",
  {
    operation: "test.read",
    args: { key: { mode: "path", path: "item.title" } },
  },
] as const;

const post = [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "hi" } },
  },
] as const;

async function setup(...nodes: (typeof readFixed | typeof post)[]) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain(nodes.map((node) => [...node])),
  );
  return { test, id };
}

describe("a test of a lookup that reads nothing about an item", () => {
  it("runs once on a blank item, with no run before it and no samples", async () => {
    const { test, id } = await setup(readFixed);
    test.operations.always("test.read", ok({ user: { id: "U1" } }));

    const result = await ran(test, id, { mode: "test", testNodeId: "read" });

    expect(test.operations.callsTo("test.read")).toHaveLength(1);
    expect(test.operations.callsTo("test.read")[0]).toMatchObject({
      fields: { key: "static" },
      credentialSlot: "test",
      mode: "test",
    });
    expect(result.run.mode).toBe("test");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["read"]);
    expect(stepOf(result, "read")).toMatchObject({
      status: "succeeded",
      fields: { in: 1 },
      ports: { out: { count: 1, itemIds: ["test-no-item"] } },
    });
    expect(result.clean).toBe(true);
    expect(
      (await eventsOf(test, id, "test-no-item")).find(
        (event) => event.nodeId === "read",
      ),
    ).toMatchObject({
      kind: "output",
      mode: "test",
      summary: 'read: {"user":{"id":"U1"}}',
    });
  });

  it("fails loudly, not as an empty pass, when the read fails", async () => {
    const { test, id } = await setup(readFixed);
    test.operations.always("test.read", {
      ok: false,
      code: "lookup_failed",
      message: "Provider said no",
      retryable: false,
      sideEffect: "none",
    });

    const result = await ran(test, id, { mode: "test", testNodeId: "read" });

    expect(stepOf(result, "read")).toMatchObject({
      status: "failed",
      error: { code: "lookup_failed" },
      ports: { out: { count: 0 } },
    });
    expect(result.clean).toBe(false);
  });

  it("still uses the samples when some are pinned", async () => {
    const { test, id } = await setup(readFixed);
    test.operations.always("test.read", ok({}));

    await ran(test, id, {
      mode: "test",
      testNodeId: "read",
      sampleItems: [
        { id: "s1", item: { title: "One" } },
        { id: "s2", item: { title: "Two" } },
      ],
    });

    expect(test.operations.callsTo("test.read")).toHaveLength(2);
  });
});

describe("a test of a step that still needs items", () => {
  it("reads nothing and calls nothing when a lookup reads the item and none is pinned", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...readItem]]));
    test.operations.always("test.read", ok({}));

    const result = await ran(test, id, { mode: "test", testNodeId: "read" });

    // The engine runs a node on whatever it is given: with no item that is
    // nothing, and the step still reads as succeeded.
    expect(test.operations.calls).toHaveLength(0);
    expect(stepOf(result, "read")).toMatchObject({
      status: "succeeded",
      fields: { in: 0 },
      ports: { out: { count: 0 } },
    });
  });

  it("never gives an action a blank item, and never writes in a test", async () => {
    const { test, id } = await setup(post);
    test.operations.always("test.write", ok(null, { externalRef: "r" }));

    const result = await ran(test, id, { mode: "test", testNodeId: "post" });

    expect(test.operations.calls).toHaveLength(0);
    expect(stepOf(result, "post").fields).toMatchObject({ in: 0 });
  });

  it("does not run the steps after a tested lookup", async () => {
    const { test, id } = await setup(readFixed, post);
    test.operations.always("test.read", ok({}));
    test.operations.always("test.write", ok(null, { externalRef: "r" }));

    const result = await ran(test, id, { mode: "test", testNodeId: "read" });

    expect(result.steps.map((step) => step.nodeId)).toEqual(["read"]);
    expect(test.operations.callsTo("test.write")).toHaveLength(0);
  });
});
