import { describe, expect, it } from "vitest";

import { MAX_ITEM_CONTEXT_BYTES } from "../../items.js";
import { buildGraph } from "../../story-graphs.fixture.js";
import {
  eventsOf,
  minutesAfter,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
  threadOf,
  threadedItem,
  waitGraph,
} from "../../testing/engine-fixtures.js";
import { ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const READ = [
  "read",
  "lookup",
  {
    operation: "test.read",
    args: { key: { mode: "path", path: "item.title" } },
  },
] as const;

const REPLY = { wait: "reply", limitHours: 24 };

async function parkOne(
  wait: Record<string, unknown> = REPLY,
  item = threadedItem("a"),
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    waitGraph(wait, { before: [[...READ]] }),
  );
  test.operations.script("test.items", sourceResult([item]));
  test.operations.always("test.read", ok({ n: 1 }));
  const result = await ran(test, id);
  return { test, id, result };
}

describe("an item that reaches a Wait", () => {
  it("is parked, not ended: its row keeps the wake and the counters, and the run goes on without it", async () => {
    const { test, id, result } = await parkOne();

    expect(result.run).toMatchObject({
      status: "succeeded",
      counts: { taken: 1, parked: 1, done: 0, needsManual: 0, woke: 0 },
    });
    expect(stepOf(result, "pause")).toMatchObject({
      status: "succeeded",
      ports: {
        replied: { count: 0, itemIds: [] },
        timedOut: { count: 0, itemIds: [] },
        // Items that stop at a Wait leave through no port; the step still counts them.
        parked: { count: 1, itemIds: ["a"] },
      },
      fields: { wait: "reply", in: 1, parked: 1 },
    });
    // Every node after the Wait ran over nothing, and says so.
    expect(stepOf(result, "end_replied").fields).toMatchObject({ in: 0 });
    expect(stepOf(result, "end_timedOut").fields).toMatchObject({ in: 0 });

    const state = await test.store.getItemState(test.scope, id, "a");
    expect(state).toMatchObject({
      parkedAtNode: "pause",
      graphVersion: 1,
      wake: {
        wait: "reply",
        dueAt: minutesAfter(24 * 60),
        nextCheckAt: minutesAfter(15),
        thread: threadOf("a"),
      },
      // Nothing after this Wait reads the item or the lookup, so neither is kept.
      context: {
        data: {},
        nodes: {},
        inbox: true,
        waitSince: result.run.startedAt,
        kept: [],
      },
    });
    expect(state?.leasedBy).toBeUndefined();
    expect(test.statuses.written).toEqual([]);
    expect((await eventsOf(test, id, "a")).map((event) => event.kind)).toEqual([
      "taken",
      "output",
      "parked",
    ]);
  });

  it("keeps what a node after the Wait reads, and the engine's own fields, and drops the rest", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(REPLY, {
        before: [[...READ]],
        ends: { reason: "{{ item.title }}: {{ nodes.read.n }}" },
      }),
    );
    test.operations.script(
      "test.items",
      sourceResult([
        threadedItem("a", {
          text: "a long body nobody reads again",
          extras: { team: "web" },
        }),
      ]),
    );
    test.operations.always("test.read", ok({ n: 1, transcript: "kept out" }));

    const result = await ran(test, id);

    const state = await test.store.getItemState(test.scope, id, "a");
    expect(state?.context).toEqual({
      data: { title: "Item a" },
      nodes: { read: { n: 1 } },
      inbox: true,
      waitSince: result.run.startedAt,
      kept: ["item.title", "nodes.read.n"],
    });
  });

  it("is left alone by the source while it waits, so the same message is not taken twice", async () => {
    const { test, id } = await parkOne();
    test.operations.always("test.items", sourceResult([threadedItem("a")]));

    const second = await ran(test, id);

    expect(stepOf(second, "src").fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    expect(second.run.counts).toMatchObject({ taken: 0, parked: 0 });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBe("pause");
  });

  it("parks a time wait with a deadline and nothing to check", async () => {
    const { test, id } = await parkOne({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });

    const state = await test.store.getItemState(test.scope, id, "a");

    expect(state?.wake).toEqual({
      wait: "time",
      dueAt: minutesAfter(3 * 24 * 60),
    });
  });

  it("parks a condition wait on the node's own check cadence, with the deadline from its limit", async () => {
    const { test, id } = await parkOne({
      wait: "condition",
      operation: "test.read",
      args: { key: { mode: "fixed", value: "k" } },
      rule: { left: "item.status", op: "equals", right: "resolved" },
      everyMinutes: 30,
      limitHours: 48,
    });

    const state = await test.store.getItemState(test.scope, id, "a");

    expect(state?.wake).toEqual({
      wait: "condition",
      dueAt: minutesAfter(48 * 60),
      nextCheckAt: minutesAfter(30),
    });
  });

  it("checks a reply wait on the graph's check cadence, and leaves the check off when the deadline comes first", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(
        { wait: "reply", limitHours: 0.1 },
        { settings: { checkCadenceMinutes: 30 } },
      ),
    );
    test.operations.script("test.items", sourceResult([threadedItem("a")]));

    await ran(test, id);

    expect((await test.store.getItemState(test.scope, id, "a"))?.wake).toEqual({
      wait: "reply",
      dueAt: minutesAfter(6),
      thread: threadOf("a"),
    });
  });

  it("watches the thread of an upstream message when the Wait names one", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(
        { wait: "reply", watch: { fromNode: "post" } },
        {
          before: [
            [
              "post",
              "action",
              {
                operation: "test.write",
                args: { text: { mode: "fixed", value: "Please look" } },
              },
            ],
          ],
        },
      ),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.script(
      "test.write",
      ok(
        { channel: "C0POST", ts: "1760000001.000100" },
        {
          externalRef: "1760000001.000100",
        },
      ),
    );

    await ran(test, id);

    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.wake?.thread,
    ).toEqual({ channelId: "C0POST", threadTs: "1760000001.000100" });
  });

  it("keeps what a downstream node needs from nodes before the Wait", async () => {
    const test = makeHost();
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", { schedule: { every: "5m" } }],
        [
          "src",
          "source",
          {
            source: "provider-query",
            operation: "test.items",
            args: {},
            memory: "inbox",
            maxItems: 50,
          },
        ],
        [...READ],
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 1, unit: "hours" } },
        ],
        [
          "end_done",
          "end",
          { outcome: "dismissed", reason: "read said {{ nodes.read.n }}" },
        ],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "read"],
        ["read", "out", "pause"],
        ["pause", "done", "end_done"],
      ],
    });
    const { id } = await seedWorkflow(test, graph);
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.always("test.read", ok({ n: 42 }));
    await ran(test, id);

    test.clock.set(minutesAfter(60));
    test.operations.script("test.items", sourceResult([]));
    await ran(test, id);

    expect(test.statuses.written).toEqual([
      {
        runId: "run-2",
        itemId: "a",
        status: "dismissed",
        reason: "read said 42",
      },
    ]);
  });
});

describe("an item that cannot be parked", () => {
  it("fails with context_truncated, parks nothing, and never parks a clipped copy", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(REPLY, {
        before: [[...READ]],
        ends: { reason: "{{ nodes.read.transcript }}" },
      }),
    );
    test.operations.always("test.items", sourceResult([threadedItem("a")]));
    test.operations.always(
      "test.read",
      ok({ transcript: "x".repeat(MAX_ITEM_CONTEXT_BYTES + 1000) }),
    );

    const first = await ran(test, id);

    expect(stepOf(first, "pause")).toMatchObject({
      status: "failed",
      error: { code: "context_truncated" },
      ports: { parked: { count: 0 } },
    });
    expect(first.run.counts).toMatchObject({ parked: 0, itemFailures: 1 });
    const state = await test.store.getItemState(test.scope, id, "a");
    expect(state?.parkedAtNode).toBeUndefined();
    expect(state?.counters).toEqual({ attempts: 1 });
    expect(
      (await eventsOf(test, id, "a")).find((event) => event.kind === "error"),
    ).toMatchObject({ code: "context_truncated", nodeId: "pause" });
  });

  it("is handed to a person at once, since waiting will not make it smaller", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(REPLY, {
        before: [[...READ]],
        ends: { reason: "{{ nodes.read.transcript }}" },
      }),
    );
    test.operations.always("test.items", sourceResult([threadedItem("a")]));
    test.operations.always(
      "test.read",
      ok({ transcript: "x".repeat(MAX_ITEM_CONTEXT_BYTES + 1000) }),
    );

    await ran(test, id);
    await ran(test, id);

    expect(test.statuses.written).toHaveLength(1);
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect(test.statuses.written[0].reason).toContain("context_truncated");
    expect(test.operations.callsTo("test.read")).toHaveLength(1);
  });

  it("fails an item with no thread to watch, naming why, instead of waiting for a reply that cannot be seen", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, waitGraph(REPLY));
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));

    const result = await ran(test, id);

    expect(stepOf(result, "pause")).toMatchObject({
      status: "failed",
      error: {
        code: "expression_failed",
        message: expect.stringContaining("no thread to watch"),
      },
    });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBeUndefined();
  });

  it("fails an item whose watched message left no thread, naming the node", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(
        { wait: "reply", watch: { fromNode: "post" } },
        {
          before: [
            [
              "post",
              "action",
              {
                operation: "test.write",
                args: { text: { mode: "fixed", value: "hi" } },
              },
            ],
          ],
        },
      ),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.script("test.write", ok({ nothing: true }));

    const result = await ran(test, id);

    expect(stepOf(result, "pause").error).toMatchObject({
      code: "expression_failed",
      message: expect.stringContaining('"post" left no thread'),
    });
  });
});

describe("a Wait in a dry run or a test of one node", () => {
  it("says what it would do, parks nothing, takes no lease, and sends nothing on", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, waitGraph(REPLY));
    test.operations.script("test.items", sourceResult([threadedItem("a")]));

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "pause")).toMatchObject({
      status: "succeeded",
      ports: { parked: { count: 1, itemIds: ["a"] } },
      fields: { wouldPark: 1 },
    });
    expect(result.run.counts).toMatchObject({ parked: 0 });
    expect(result.clean).toBe(true);
    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
    const parked = (await eventsOf(test, id, "a")).find(
      (event) => event.kind === "parked",
    );
    expect(parked).toMatchObject({
      mode: "dry",
      summary: expect.stringContaining("would park"),
    });
  });

  it("does the same when only the Wait is tested, on a pinned sample", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, waitGraph(REPLY));

    const result = await ran(test, id, {
      mode: "test",
      testNodeId: "pause",
      sampleItems: [
        { id: "x", item: { title: "Pinned", thread: threadOf("x") } },
      ],
    });

    expect(result.steps.map((step) => step.nodeId)).toEqual(["pause"]);
    expect(stepOf(result, "pause").fields).toMatchObject({ wouldPark: 1 });
    expect(await test.store.getItemState(test.scope, id, "x")).toBeNull();
  });

  it("never wakes a parked item in a dry run, even one whose time has come", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph({ wait: "time", duration: { amount: 1, unit: "hours" } }),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    await ran(test, id);
    test.clock.set(minutesAfter(120));
    test.operations.always("test.items", sourceResult([]));

    const dry = await ran(test, id, { mode: "dry", tickKey: "dry-1" });

    expect(dry.run.counts).toMatchObject({ woke: 0 });
    expect(stepOf(dry, "pause").fields).toMatchObject({ in: 0 });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBe("pause");
  });
});
