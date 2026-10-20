import { describe, expect, it } from "vitest";

import { loopCounterKey } from "../contract.js";
import { MAX_ITEM_CONTEXT_BYTES } from "../items.js";
import {
  buildGraph,
  type EdgeSpec,
  type NodeSpec,
} from "../story-graphs.fixture.js";
import {
  T0,
  eventsOf,
  minutesAfter,
  ranAt,
  sourceResult,
  stepOf,
  threadOf,
  threadedItem,
} from "../testing/engine-fixtures.js";
import { ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";

const EVERY_5M = { schedule: { every: "5m" } };
const SOURCE = {
  source: "provider-query",
  operation: "test.items",
  args: {},
  memory: "inbox",
  maxItems: 50,
};

const ask: NodeSpec = [
  "ask",
  "action",
  {
    operation: "test.write",
    args: {
      text: {
        mode: "fixed",
        value: "Question {{ loop.iteration }} of {{ loop.max }}",
      },
    },
  },
];
const reread: NodeSpec = [
  "reread",
  "lookup",
  {
    operation: "test.read",
    args: { key: { mode: "path", path: "item.title" } },
  },
];

/**
 * trigger -> source -> [reread] -> ask -> Wait for a reply. A reply goes back
 * to the first node of the loop, up to `max` times; a time out, or running out
 * of passes, ends the item for a person.
 */
function askLoop(
  options: { max?: number; reread?: boolean; readsTranscript?: boolean } = {},
) {
  const head = options.reread ? "reread" : "ask";
  const nodes: NodeSpec[] = [
    ["start", "trigger", EVERY_5M],
    ["src", "source", SOURCE],
    ...(options.reread ? [reread] : []),
    ask,
    ["pause", "wait", { wait: "reply", limitHours: 24 }],
    [
      "gaveUp",
      "end",
      {
        outcome: "needsManual",
        // Something after the Wait reads what the reread returned, so a parked item has to keep it.
        ...(options.readsTranscript
          ? { reason: "{{ nodes.reread.transcript }}" }
          : {}),
      },
    ],
    ["exhausted", "end", { outcome: "needsManual" }],
  ];
  const edges: EdgeSpec[] = [
    ["start", "out", "src"],
    ["src", "out", head],
    ...(options.reread ? ([["reread", "out", "ask"]] as EdgeSpec[]) : []),
    ["ask", "out", "pause"],
    ["pause", "replied", head, options.max ?? 2],
    ["pause", "timedOut", "gaveUp"],
    ["pause", "limitReached", "exhausted"],
  ];
  return buildGraph({ nodes, edges });
}

/** The id of the back-edge in `askLoop`: edges are numbered in the order they are listed, and it is the one from `pause` to the head. */
const backEdgeId = (withReread: boolean) => (withReread ? "e5" : "e4");

async function setup(graph = askLoop(), items = [threadedItem("a")]) {
  const test = makeHost();
  const { id } = await seedWorkflow(test, graph);
  test.operations.script("test.items", sourceResult(items));
  test.operations.always("test.items", sourceResult([]));
  test.operations.always("test.read", ok({ n: 1 }));
  test.operations.always("test.write", ok(null, { externalRef: "m" }));
  await ranAt(test, id, T0);
  return { test, id };
}

const reply = (test: TestHost, minutes: number, itemId = "a") =>
  test.threads.post(threadOf(itemId), {
    at: minutesAfter(minutes),
    author: "reporter@example.test",
    text: `reply at ${minutes}`,
  });

const questions = (test: TestHost) =>
  test.operations.callsTo("test.write").map((call) => call.fields.text);

const stateOf = (test: TestHost, id: string, itemId = "a") =>
  test.store.getItemState(test.scope, id, itemId);

describe("a loop back through a Wait", () => {
  it("sends a replied item back to the head, counts the pass, and parks it again with the new question", async () => {
    const { test, id } = await setup();
    reply(test, 10);

    const result = await ranAt(test, id, minutesAfter(15));

    expect(questions(test)).toEqual(["Question 0 of 2", "Question 1 of 2"]);
    expect(result.run.counts).toMatchObject({
      woke: 1,
      sentBack: 1,
      parked: 1,
    });
    expect(stepOf(result, "pause").ports).toMatchObject({
      replied: { count: 1, itemIds: ["a"] },
      parked: { count: 1, itemIds: ["a"] },
    });
    const state = await stateOf(test, id);
    expect(state?.parkedAtNode).toBe("pause");
    expect(state?.counters).toEqual({
      [loopCounterKey(backEdgeId(false))]: 1,
      rounds: 1,
    });
    // The wait began again with the new question.
    expect(state?.context).toMatchObject({ waitSince: minutesAfter(15) });
    const decision = (await eventsOf(test, id, "a")).find(
      (event) => event.kind === "decision",
    );
    expect(decision).toMatchObject({
      nodeId: "pause",
      port: "replied",
      summary: 'sent back to "ask": pass 1 of 2',
    });
  });

  it("sends the item back as before when its pass count is above its rounds", async () => {
    const { test, id } = await setup();
    const edgeId = backEdgeId(false);
    // A pass was counted that no round went with.
    await test.store.incrementCounter(test.scope, {
      workflowId: id,
      itemId: "a",
      counter: loopCounterKey(edgeId),
    });
    reply(test, 10);

    const result = await ranAt(test, id, minutesAfter(15));

    expect(result.run.counts).toMatchObject({
      woke: 1,
      sentBack: 1,
      parked: 1,
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBe("pause");
  });

  it("lets an item go round the loop its maximum, then sends the next reply out of Limit reached", async () => {
    const { test, id } = await setup();
    reply(test, 10);
    await ranAt(test, id, minutesAfter(15));
    reply(test, 20);
    await ranAt(test, id, minutesAfter(30));
    expect(questions(test)).toEqual([
      "Question 0 of 2",
      "Question 1 of 2",
      "Question 2 of 2",
    ]);
    expect(
      (await stateOf(test, id))?.counters[loopCounterKey(backEdgeId(false))],
    ).toBe(2);
    reply(test, 40);

    const third = await ranAt(test, id, minutesAfter(45));

    expect(stepOf(third, "pause").ports).toMatchObject({
      limitReached: { count: 1, itemIds: ["a"] },
    });
    expect(stepOf(third, "exhausted").ports).toEqual({});
    expect(third.run.counts).toMatchObject({
      loopLimited: 1,
      sentBack: 0,
      needsManual: 1,
      parked: 0,
    });
    // No fourth question, and the item is for a person.
    expect(questions(test)).toHaveLength(3);
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
    const limit = (await eventsOf(test, id, "a")).find(
      (event) => event.port === "limitReached",
    );
    expect(limit?.summary).toBe(
      "loop limit reached: already sent back 2 of 2 times",
    );
  });

  it("counts every item's passes on its own, in one tick, with no pass lost", async () => {
    const items = ["a", "b", "c"].map((name) => threadedItem(name));
    const { test, id } = await setup(askLoop({ max: 3 }), items);
    for (const name of ["a", "b", "c"]) reply(test, 10, name);

    await ranAt(test, id, minutesAfter(15));
    for (const name of ["a", "b"]) reply(test, 20, name);
    await ranAt(test, id, minutesAfter(30));

    const passes = await Promise.all(
      ["a", "b", "c"].map(
        async (name) =>
          (await stateOf(test, id, name))?.counters[
            loopCounterKey(backEdgeId(false))
          ],
      ),
    );
    expect(passes).toEqual([2, 2, 1]);
  });

  it("reads loop.iteration and loop.max inside the loop, and fails a path to them outside it", async () => {
    const test = makeHost();
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["src", "source", SOURCE],
        ask,
        ["pause", "wait", { wait: "reply", limitHours: 24 }],
        ["gaveUp", "end", { outcome: "needsManual" }],
        [
          "exhausted",
          "end",
          { outcome: "needsManual", reason: "pass {{ loop.iteration }}" },
        ],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "ask"],
        ["ask", "out", "pause"],
        ["pause", "replied", "ask", 1],
        ["pause", "timedOut", "gaveUp"],
        ["pause", "limitReached", "exhausted"],
      ],
    });
    const { id } = await seedWorkflow(test, graph);
    test.operations.script("test.items", sourceResult([threadedItem("a")]));
    test.operations.always("test.items", sourceResult([]));
    test.operations.always("test.write", ok(null, { externalRef: "m" }));
    await ranAt(test, id, T0);
    reply(test, 10);
    await ranAt(test, id, minutesAfter(15));
    expect(questions(test)).toEqual(["Question 0 of 1", "Question 1 of 1"]);
    reply(test, 20);

    const result = await ranAt(test, id, minutesAfter(30));

    // `exhausted` is not on the loop, so it has no `loop` to read: a failure, not a zero.
    expect(stepOf(result, "exhausted")).toMatchObject({
      status: "failed",
      error: { code: "expression_failed" },
    });
  });

  it("does not count a pass its tick never finished: the repeat has the same counters and sends the question once", async () => {
    const { test, id } = await setup(askLoop({ reread: true }));
    reply(test, 10);
    test.operations.script("test.read", () => {
      throw new Error("the process died while rereading");
    });

    await expect(ranAt(test, id, minutesAfter(15))).rejects.toThrow("died");

    // Nothing of the half-finished pass was written: still the first wait, same counters.
    const parked = await stateOf(test, id);
    expect(parked?.parkedAtNode).toBe("pause");
    expect(parked?.counters).toEqual({});
    expect(questions(test)).toEqual(["Question 0 of 2"]);

    const retry = await ranAt(test, id, minutesAfter(20));

    expect(questions(test)).toEqual(["Question 0 of 2", "Question 1 of 2"]);
    expect(retry.run.counts).toMatchObject({ sentBack: 1, parked: 1 });
    expect((await stateOf(test, id))?.counters).toEqual({
      [loopCounterKey(backEdgeId(true))]: 1,
      rounds: 1,
    });
  });

  it("hands an item to a person when its pass cannot park it, and does not ask the question again", async () => {
    const { test, id } = await setup(
      askLoop({ reread: true, readsTranscript: true }),
    );
    reply(test, 10);
    // The pass reads, asks, and then cannot park: what the read returned is too big to keep.
    test.operations.always(
      "test.read",
      ok({ transcript: "x".repeat(MAX_ITEM_CONTEXT_BYTES + 500) }),
    );

    const first = await ranAt(test, id, minutesAfter(15));
    expect(stepOf(first, "pause")).toMatchObject({
      status: "failed",
      error: { code: "context_truncated" },
    });
    expect(questions(test)).toEqual(["Question 0 of 2", "Question 1 of 2"]);
    // Nothing can fix that by waiting, so it is not parked again and not counted as a pass.
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
    expect((await stateOf(test, id))?.counters).toEqual({ attempts: 1 });

    await ranAt(test, id, minutesAfter(20));

    expect(questions(test)).toEqual(["Question 0 of 2", "Question 1 of 2"]);
  });

  it("does not let the reply that sent an item round answer the question it was sent round to ask, even when it arrived while the tick ran", async () => {
    const { test, id } = await setup();
    // Posted half a minute after the tick began, and seen by it all the same.
    reply(test, 15.5);

    const first = await ranAt(test, id, minutesAfter(15));
    expect(first.run.counts).toMatchObject({ woke: 1, sentBack: 1 });
    expect((await stateOf(test, id))?.context).toMatchObject({
      waitSince: minutesAfter(15.5),
    });
    const second = await ranAt(test, id, minutesAfter(30));

    // The new wait found no reply of its own, so the item is still waiting for one.
    expect(second.run.counts).toMatchObject({ woke: 0, stillWaiting: 1 });
    expect(questions(test)).toHaveLength(2);
  });

  it("runs a looped item and a new item through the loop's nodes together, once", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", sourceResult([threadedItem("b")]));
    reply(test, 10);

    const result = await ranAt(test, id, minutesAfter(15));

    // Both reach `ask` as one batch: the replied item at the start, the new one from the source.
    expect(stepOf(result, "ask").fields).toMatchObject({ in: 2 });
    expect(questions(test).slice(1).sort()).toEqual([
      "Question 0 of 2",
      "Question 1 of 2",
    ]);
    expect(result.run.counts).toMatchObject({ parked: 2, sentBack: 1 });
  });

  it("sends an item that has used its passes out of Limit reached while another goes round", async () => {
    const items = ["a", "b"].map((name) => threadedItem(name));
    const { test, id } = await setup(askLoop({ max: 1 }), items);
    for (const name of ["a", "b"]) reply(test, 10, name);
    await ranAt(test, id, minutesAfter(15));
    reply(test, 20, "a");
    // b never replies again; a has used its one pass.

    const result = await ranAt(test, id, minutesAfter(30));

    expect(stepOf(result, "pause").ports).toMatchObject({
      replied: { count: 1, itemIds: ["a"] },
      limitReached: { count: 1, itemIds: ["a"] },
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect(test.statuses.statusOf("b")).toBeUndefined();
  });
});

describe("a back-edge from a node that is not the Wait", () => {
  // Wait -> Replied -> a check on what was said; "not yet" goes back to ask.
  function checkedLoop() {
    return buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["src", "source", SOURCE],
        ask,
        ["pause", "wait", { wait: "reply", limitHours: 24 }],
        [
          "verdict",
          "filter",
          {
            combinator: "all",
            rules: [
              { left: "nodes.pause.first.text", op: "equals", right: "done" },
            ],
          },
        ],
        ["finished", "end", { outcome: "done" }],
        ["gaveUp", "end", { outcome: "needsManual" }],
        ["exhausted", "end", { outcome: "needsManual" }],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "ask"],
        ["ask", "out", "pause"],
        ["pause", "replied", "verdict"],
        ["pause", "timedOut", "gaveUp"],
        ["verdict", "match", "finished"],
        ["verdict", "otherwise", "ask", 2],
        ["verdict", "limitReached", "exhausted"],
      ],
    });
  }

  it("runs the loop's nodes again in the same tick, and each node's step row totals both runs", async () => {
    const { test, id } = await setup(checkedLoop());
    test.threads.post(threadOf("a"), {
      at: minutesAfter(10),
      author: "reporter@example.test",
      text: "not yet",
    });

    const result = await ranAt(test, id, minutesAfter(15));

    expect(questions(test)).toEqual(["Question 0 of 2", "Question 1 of 2"]);
    expect(result.run.counts).toMatchObject({
      sentBack: 1,
      parked: 1,
      woke: 1,
    });
    // The Wait ran to wake the item and again to park it; one row, both counted.
    expect(stepOf(result, "pause")).toMatchObject({
      status: "succeeded",
      ports: {
        replied: { count: 1 },
        parked: { count: 1, itemIds: ["a"] },
      },
      fields: { due: 1, woke: 1, parked: 1 },
    });
    expect(stepOf(result, "verdict").ports).toMatchObject({
      match: { count: 0 },
      otherwise: { count: 1 },
    });
  });

  it("ends the item when the reply is the answer", async () => {
    const { test, id } = await setup(checkedLoop());
    test.threads.post(threadOf("a"), {
      at: minutesAfter(10),
      author: "reporter@example.test",
      text: "done",
    });

    const result = await ranAt(test, id, minutesAfter(15));

    expect(result.run.counts).toMatchObject({ sentBack: 0, done: 1 });
    expect(test.statuses.statusOf("a")).toBe("resolved");
  });
});

describe("a graph whose loop the engine cannot trust", () => {
  const runOf = async (graph: ReturnType<typeof buildGraph>) => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, graph);
    const result = await ranAt(test, id, T0);
    expect(test.operations.calls).toEqual([]);
    expect(test.inbox.requests).toEqual([]);
    return result.run;
  };

  it("refuses a loop that never passes through a Wait, before anything runs", async () => {
    const run = await runOf(
      buildGraph({
        nodes: [
          ["start", "trigger", EVERY_5M],
          ["src", "source", SOURCE],
          ["a", "combine", { mode: "count" }],
          ["b", "combine", { mode: "count" }],
          ["pause", "wait", { wait: "reply", limitHours: 24 }],
          ["done", "end", { outcome: "done" }],
          ["gaveUp", "end", { outcome: "needsManual" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "a"],
          ["a", "out", "b"],
          ["b", "out", "pause"],
          ["pause", "replied", "done"],
          ["pause", "timedOut", "gaveUp"],
          ["b", "out", "a", 3],
          ["b", "limitReached", "done"],
        ],
      }),
    );

    expect(run).toMatchObject({
      status: "failed",
      error: { code: "graph_invalid" },
    });
    expect(run.error?.message).toContain("loop_without_wait");
  });

  it("refuses a cycle that is not flagged as a loop", async () => {
    const run = await runOf(
      buildGraph({
        nodes: [
          ["start", "trigger", EVERY_5M],
          ["src", "source", SOURCE],
          ["pause", "wait", { wait: "reply", limitHours: 24 }],
          ["done", "end", { outcome: "done" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "pause"],
          ["pause", "replied", "src"],
          ["pause", "timedOut", "done"],
        ],
      }),
    );

    expect(run.error?.code).toBe("graph_invalid");
    expect(run.error?.message).toContain("cycle_without_back_edge");
  });

  it("refuses a loop whose Limit reached port leads nowhere", async () => {
    const run = await runOf(
      buildGraph({
        nodes: [
          ["start", "trigger", EVERY_5M],
          ["src", "source", SOURCE],
          ask,
          ["pause", "wait", { wait: "reply", limitHours: 24 }],
          ["gaveUp", "end", { outcome: "needsManual" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "ask"],
          ["ask", "out", "pause"],
          ["pause", "replied", "ask", 2],
          ["pause", "timedOut", "gaveUp"],
        ],
      }),
    );

    expect(run.error?.code).toBe("graph_invalid");
    expect(run.error?.message).toContain("port_leads_nowhere");
  });
});

describe("a loop in a dry run", () => {
  it("never sends anything back, because the Wait holds its items back", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, askLoop());
    test.operations.script("test.items", sourceResult([threadedItem("a")]));

    const result = await ranAt(test, id, T0, { mode: "dry", tickKey: "dry" });

    expect(result.run.counts).toMatchObject({ sentBack: 0, parked: 0 });
    expect(stepOf(result, "pause").fields).toMatchObject({ wouldPark: 1 });
    expect(await stateOf(test, id)).toBeNull();
  });
});
