import { describe, expect, it } from "vitest";

import {
  chain,
  endWith,
  eventsOf,
  last,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
  T0,
} from "../../testing/engine-fixtures.js";
import { ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";
import { combinedItemId } from "./combine.js";

async function setup(
  end: Record<string, unknown>,
  options: {
    source?: Record<string, unknown>;
    nodes?: Parameters<typeof chain>[0];
  } = {},
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain(options.nodes ?? [], { end, source: options.source }),
  );
  test.operations.script(
    "test.items",
    sourceResult([normalizedItem("a", { title: "Crash on login" })]),
  );
  return { test, id };
}

describe("an End node", () => {
  it.each([
    ["done", "resolved"],
    ["needsManual", "needs_manual"],
  ] as const)(
    "moves an inbox item to its status on %s",
    async (outcome, status) => {
      const { test, id } = await setup(endWith(outcome));

      const result = await ran(test, id);

      expect(test.statuses.written).toEqual([
        { runId: "run-1", itemId: "a", status },
      ]);
      expect(result.run.counts[outcome]).toBe(1);
      expect(last(await eventsOf(test, id, "a"))).toMatchObject({
        kind: "ended",
        nodeId: "done",
        outcome,
        summary: `${outcome} (status ${status})`,
      });
    },
  );

  it("dismisses with a reason written for the item", async () => {
    const { test, id } = await setup(
      endWith("dismissed", { reason: "{{ item.title }} is not a bug" }),
    );

    await ran(test, id);

    expect(test.statuses.written).toEqual([
      {
        runId: "run-1",
        itemId: "a",
        status: "dismissed",
        reason: "Crash on login is not a bug",
      },
    ]);
  });

  it("uses the status the node names instead of the outcome's own", async () => {
    const { test, id } = await setup(
      endWith("done", { setStatus: "automation_started" }),
    );

    await ran(test, id);

    expect(test.statuses.written[0]).toMatchObject({
      status: "automation_started",
    });
  });

  it("leaves a released item exactly as it was, and says so", async () => {
    const { test, id } = await setup(endWith("released"));

    const result = await ran(test, id);

    expect(test.statuses.written).toEqual([]);
    expect(result.run.counts.released).toBe(1);
    expect(last(await eventsOf(test, id, "a"))).toMatchObject({
      kind: "ended",
      outcome: "released",
      summary: "released",
    });
    // A released item can be taken again next tick.
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.leasedBy,
    ).toBeUndefined();
  });

  it("does not touch the inbox for an item that is not a row", async () => {
    const { test, id } = await setup(endWith("done"), {
      source: {
        source: "provider-query",
        operation: "test.items",
        args: {},
        memory: "none",
        maxItems: 10,
      },
    });

    const result = await ran(test, id);

    expect(test.statuses.written).toEqual([]);
    expect(result.run.counts.done).toBe(1);
  });

  it("fails an item whose reason cannot be written, and hands it to a person instead of ending it blank", async () => {
    const { test, id } = await setup(
      endWith("dismissed", { reason: "{{ item.nothing }}" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "done").error).toMatchObject({
      code: "expression_failed",
      message: expect.stringContaining("reason:"),
    });
    // Not dismissed: it was never given the reason the graph asked for.
    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "a", status: "needs_manual" }),
    ]);
  });

  it("fails an item, with no ended event, when the inbox refuses the status", async () => {
    const { test, id } = await setup(endWith("done"));
    test.statuses.refuseNext("the inbox is down");

    const result = await ran(test, id);

    const step = stepOf(result, "done");
    expect(step.status).toBe("failed");
    expect(step.error).toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("the inbox is down"),
    });
    // A refusal that is worth another try sets the item aside for it.
    expect((await eventsOf(test, id, "a")).map((event) => event.kind)).toEqual([
      "taken",
      "error",
      "parked",
    ]);
    expect(result.run.counts.done).toBe(0);
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({ attempts: 1 });
  });

  it("records the event but changes nothing in a dry run or a test", async () => {
    const { test, id } = await setup(endWith("needsManual"));

    const dry = await ran(test, id, { mode: "dry" });
    const tested = await ran(test, id, {
      mode: "test",
      testNodeId: "done",
      sampleItems: [{ id: "sample", item: { title: "Pinned" } }],
    });

    expect(test.statuses.written).toEqual([]);
    expect(dry.run.counts.needsManual).toBe(1);
    expect(last(await eventsOf(test, id, "a"))).toMatchObject({
      mode: "dry",
      kind: "ended",
    });
    expect(last(await eventsOf(test, id, "sample"))).toMatchObject({
      mode: "test",
      kind: "ended",
    });
    expect(tested.steps.map((step) => step.nodeId)).toEqual(["done"]);
  });

  it("ends the inbox items a combined item stands for, and records it on each", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([["all", "combine", { mode: "count" }]], {
        end: endWith("needsManual"),
      }),
    );
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("r1"), normalizedItem("r2")]),
    );
    test.operations.always("test.write", ok(null));

    await ran(test, id);

    expect(
      test.statuses.written.map((entry) => [entry.itemId, entry.status]),
    ).toEqual([
      ["r1", "needs_manual"],
      ["r2", "needs_manual"],
    ]);
    expect(last(await eventsOf(test, id, "r2"))).toMatchObject({
      kind: "ended",
      outcome: "needsManual",
      summary: `needsManual (status needs_manual), through ${combinedItemId({
        kind: "count",
        nodeId: "all",
        memberIds: ["r1", "r2"],
        windowStart: T0,
      })}`,
    });
  });
});
