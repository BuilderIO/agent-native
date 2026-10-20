import { describe, expect, it } from "vitest";

import { buildGraph } from "../story-graphs.fixture.js";
import {
  EVERY_5M,
  T0,
  chain,
  endWith,
  eventsOf,
  minutesAfter,
  normalizedItem,
  offerRows,
  ran,
  sourceResult,
  stepOf,
} from "../testing/engine-fixtures.js";
import { aiWholeList, failure, ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";
import { combinedItemId } from "./nodes/combine.js";

const INBOX = { source: "inbox-poll", poller: "slack", takeLimit: 10 };

const count = [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "n={{ item.count }}" } },
  },
] as const;

const lookup = [
  "look",
  "lookup",
  { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
] as const;

const texts = (test: TestHost) =>
  test.operations.callsTo("test.write").map((call) => call.fields.text);

const rows = (...ids: string[]) => ids.map((id) => normalizedItem(id));

const stateOf = (test: TestHost, workflowId: string, itemId: string) =>
  test.store.getItemState(test.scope, workflowId, itemId);

const parkedAt = async (test: TestHost, workflowId: string, itemId: string) =>
  (await stateOf(test, workflowId, itemId))?.parkedAtNode;

describe("the rows a parked list stands for", () => {
  async function digestOverRows() {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [["digest", "combine", { mode: "list" }], [...lookup], [...count]],
        {
          source: INBOX,
        },
      ),
    );
    const pool = rows("a", "b", "c");
    offerRows(test, pool);
    test.operations.always("test.read", ok({ v: 1 }));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    return { test, id, pool };
  }

  it("are held while the list waits for the next run, so they are not listed a second time", async () => {
    const { test, id, pool } = await digestOverRows();
    // The soft deadline arrives right after the lookup, before the post.
    test.stopWhen(
      () =>
        test.operations.callsTo("test.read").length > 0 &&
        test.operations.callsTo("test.write").length === 0,
    );
    const first = await ran(test, id);
    const list = combinedItemId({
      kind: "list",
      nodeId: "digest",
      memberIds: ["a", "b", "c"],
      windowStart: T0,
    });

    expect(first.run).toMatchObject({
      status: "paused",
      counts: { taken: 3, setAside: 1 },
    });
    expect(await parkedAt(test, id, list)).toBe("post");
    for (const row of ["a", "b", "c"]) {
      const held = await stateOf(test, id, row);
      expect(held?.parkedAtNode).toBe("post");
      expect(held?.context.heldBy).toBe(list);
      // Held for the list, not due: the resume pass has nothing to do with it.
      expect(Date.parse(held?.wake?.dueAt ?? "")).toBeGreaterThan(
        Date.parse(minutesAfter(30)),
      );
    }
    expect(texts(test)).toEqual([]);

    // A fourth row arrives before the next run.
    pool.push(normalizedItem("d"));
    test.stopWhen(() => false);
    const second = await ran(test, id);

    // The three go out once, in the list that was already made; the new one goes in a list of its own.
    expect(
      texts(test)
        .filter((text) => text !== "n=0")
        .sort(),
    ).toEqual(["n=1", "n=3"]);
    expect(second.run.counts).toMatchObject({ taken: 1, continued: 1 });
    expect(
      test.statuses.written.map((entry) => `${entry.itemId}:${entry.status}`),
    ).toEqual(
      expect.arrayContaining(["a:resolved", "b:resolved", "c:resolved"]),
    );
    expect(
      test.statuses.written.filter((entry) => entry.itemId === "a"),
    ).toHaveLength(1);
    for (const row of ["a", "b", "c", "d", list]) {
      expect(await parkedAt(test, id, row)).toBeUndefined();
    }
  });

  it("are given back with the list when it ends released, so they come round again", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([["digest", "combine", { mode: "list" }], [...lookup]], {
        source: INBOX,
        end: endWith("released"),
      }),
    );
    offerRows(test, rows("a", "b"));
    test.operations.always("test.read", ok({ v: 1 }));
    test.stopWhen(() => test.operations.callsTo("test.read").length > 0);

    await ran(test, id);
    expect(await parkedAt(test, id, "a")).toBe("done");

    test.stopWhen(() => false);
    const second = await ran(test, id);

    // The list ended released, so what it stood for is offered afresh rather than held for ever.
    // (The other release is the empty list this run makes of nothing new.)
    expect(second.run.counts).toMatchObject({ released: 2, continued: 1 });
    expect(await parkedAt(test, id, "a")).toBeUndefined();
    expect(await parkedAt(test, id, "b")).toBeUndefined();
    expect(test.statuses.written).toEqual([]);
  });

  it("are not offered again while a whole-list answer waits for a retry, so the answer goes out once", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [
            "sum",
            "ai",
            {
              instruction: "Summarize all",
              mode: "wholeList",
              batchSize: 1,
              result: { text: { type: "string" } },
            },
          ],
          [
            "post",
            "action",
            {
              operation: "test.write",
              args: { text: { mode: "path", path: "nodes.sum.text" } },
            },
          ],
        ],
        { source: INBOX },
      ),
    );
    offerRows(test, rows("a", "b"));
    test.ai.always(aiWholeList({ text: "summary" }));
    const blip = () => failure("provider_error", { retryable: true });
    test.operations.script("test.write", blip(), blip(), blip());
    test.operations.always("test.write", ok({}, { externalRef: "m" }));

    const first = await ran(test, id);
    test.clock.set(minutesAfter(6));
    const second = await ran(test, id);

    expect(first.run.counts).toMatchObject({ taken: 2, retryParked: 1 });
    expect(second.run.counts).toMatchObject({ retried: 1, done: 1 });
    // Three tries that failed, then the one that went out.
    expect(test.operations.callsTo("test.write")).toHaveLength(4);
    expect(test.ai.requests).toHaveLength(1);
    expect(
      test.statuses.written.map((entry) => `${entry.itemId}:${entry.status}`),
    ).toEqual(["a:resolved", "b:resolved"]);
  });
});

describe("a whole-list answer that is retried more than once", () => {
  it("keeps its rows held through every retry and sends once when one works", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [
            "sum",
            "ai",
            {
              instruction: "Summarize all",
              mode: "wholeList",
              batchSize: 1,
              result: { text: { type: "string" } },
            },
          ],
          [
            "post",
            "action",
            {
              operation: "test.write",
              args: { text: { mode: "path", path: "nodes.sum.text" } },
            },
          ],
        ],
        { source: INBOX },
      ),
    );
    offerRows(test, rows("a", "b"));
    test.ai.always(aiWholeList({ text: "summary" }));
    const blip = () => failure("provider_error", { retryable: true });
    test.operations.script("test.write", ...Array.from({ length: 6 }, blip));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));

    await ran(test, id);
    test.clock.set(minutesAfter(6));
    const second = await ran(test, id);
    expect(second.run.counts).toMatchObject({ retried: 1, retryParked: 1 });
    expect(await parkedAt(test, id, "a")).toBe("post");
    expect(await parkedAt(test, id, "b")).toBe("post");

    test.clock.set(minutesAfter(20));
    const third = await ran(test, id);

    expect(third.run.counts).toMatchObject({ retried: 1, done: 1 });
    expect(test.ai.requests).toHaveLength(1);
    expect(
      test.statuses.written.map((entry) => `${entry.itemId}:${entry.status}`),
    ).toEqual(["a:resolved", "b:resolved"]);
    expect(await parkedAt(test, id, "a")).toBeUndefined();
  });
});

describe("the same rows asked about twice", () => {
  it("make one whole-list answer, named by the rows and not by the run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [
            "sum",
            "ai",
            {
              instruction: "Summarize all",
              mode: "wholeList",
              batchSize: 1,
              result: { text: { type: "string" } },
            },
          ],
        ],
        { source: INBOX, end: endWith("released") },
      ),
    );
    offerRows(test, rows("a", "b"));
    test.ai.always(aiWholeList({ text: "summary" }));

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(stepOf(first, "sum").ports.out.itemIds).toEqual(
      stepOf(second, "sum").ports.out.itemIds,
    );
  });
});

describe("a split", () => {
  const entries = ["each", "split", { field: "nodes.look.entries" }] as const;

  async function splitRow(end: Record<string, unknown> = endWith("done")) {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...lookup], [...entries]], {
        source: { ...INBOX, takeLimit: 5 },
        end,
      }),
    );
    const parent = normalizedItem("msg-1");
    offerRows(test, [parent]);
    test.operations.always("test.read", ok({ entries: [{ a: 1 }, { a: 2 }] }));
    return { test, id };
  }

  it("ends the inbox row it split once its children are all ended, so the row is not offered again", async () => {
    const { test, id } = await splitRow();

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "msg-1", status: "resolved" }),
    ]);
    expect(test.statuses.rowStatus.get("msg-1")).toBe("resolved");
    expect(first.run.counts).toMatchObject({ taken: 1, done: 3 });
    expect(second.run.counts).toMatchObject({ taken: 0 });
    const trail = (await eventsOf(test, id, "msg-1")).filter(
      (event) => event.kind === "ended",
    );
    expect(trail).toHaveLength(1);
  });

  it("hands the row to a person when a child was, so the row says where the trouble is", async () => {
    const { test, id } = await splitRow(endWith("needsManual"));

    await ran(test, id);

    expect(test.statuses.rowStatus.get("msg-1")).toBe("needs_manual");
  });

  it("keeps the row open when a child was released, so it comes round again with its children", async () => {
    const { test, id } = await splitRow(endWith("released"));

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(test.statuses.written).toEqual([]);
    expect(first.run.counts).toMatchObject({ taken: 1, released: 3 });
    expect(second.run.counts).toMatchObject({ taken: 1 });
  });

  it("ends the row that had nothing to split, which is not a row still to be handled", async () => {
    const { test, id } = await splitRow();
    test.operations.always("test.read", ok({ entries: [] }));

    await ran(test, id);

    expect(test.statuses.rowStatus.get("msg-1")).toBe("resolved");
  });

  it("ends the rows of a list it split into entries of their own, with those entries", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          ["digest", "combine", { mode: "list" }],
          [...lookup],
          ["each", "split", { field: "nodes.look.entries" }],
        ],
        { source: INBOX },
      ),
    );
    offerRows(test, rows("a", "b"));
    test.operations.always(
      "test.read",
      ok({ entries: [{ a: 1 }, { a: 2 }, { a: 3 }] }),
    );
    test.stopWhen(() => test.operations.callsTo("test.read").length > 0);
    await ran(test, id);
    expect(await parkedAt(test, id, "a")).toBe("each");

    test.stopWhen(() => false);
    const second = await ran(test, id);
    const third = await ran(test, id);

    // The three entries ended with their own End; the two rows ended with them, once each.
    expect(
      test.statuses.written.map((entry) => `${entry.itemId}:${entry.status}`),
    ).toEqual(["a:resolved", "b:resolved"]);
    expect(await parkedAt(test, id, "a")).toBeUndefined();
    expect(second.run.counts).toMatchObject({ continued: 1 });
    expect(third.run.counts).toMatchObject({ continued: 0, taken: 0 });
  });

  it("lets a row the split left out be offered again, never ended for work nobody did", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [
            "sum",
            "ai",
            {
              instruction: "Group them",
              mode: "wholeList",
              batchSize: 1,
              result: { groups: { type: "array" } },
            },
          ],
          ["each", "split", { field: "nodes.sum.groups" }],
        ],
        { source: INBOX },
      ),
    );
    offerRows(test, rows("a", "b", "c"));
    // The model answers for two of the three reports.
    test.ai.always(aiWholeList({ groups: [{ id: "a" }, { id: "b" }] }));

    const first = await ran(test, id);

    expect(
      test.statuses.written.map((entry) => `${entry.itemId}:${entry.status}`),
    ).toEqual(["a:resolved", "b:resolved"]);
    expect(first.run.counts).toMatchObject({ taken: 3 });
    const second = await ran(test, id);
    expect(second.run.counts).toMatchObject({ taken: 1 });
  });

  it("lets go of a list it split, so the list is not woken again in every run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          ["digest", "combine", { mode: "list" }],
          [...lookup],
          ["each", "split", { field: "item.items" }],
          [
            "post",
            "action",
            {
              operation: "test.write",
              args: { text: { mode: "fixed", value: "{{ item.id }}" } },
            },
          ],
        ],
        { source: INBOX },
      ),
    );
    offerRows(test, rows("a", "b"));
    test.operations.always("test.read", ok({ v: 1 }));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    // Stopped after the lookup, so the list is set aside in front of the split.
    test.stopWhen(
      () =>
        test.operations.callsTo("test.read").length > 0 &&
        test.operations.callsTo("test.write").length === 0,
    );
    await ran(test, id);
    const list = combinedItemId({
      kind: "list",
      nodeId: "digest",
      memberIds: ["a", "b"],
      windowStart: T0,
    });
    expect(await parkedAt(test, id, list)).toBe("each");

    test.stopWhen(() => false);
    const second = await ran(test, id);
    const third = await ran(test, id);

    expect(second.run.counts).toMatchObject({ continued: 1, done: 2 });
    expect(await parkedAt(test, id, list)).toBeUndefined();
    expect(third.run.counts).toMatchObject({ continued: 0, taken: 0 });
    expect(texts(test).sort()).toEqual(["a", "b"]);
  });
});

describe("items that were woken and folded into one", () => {
  it("are let go of, so they are not woken again in every run", async () => {
    const test = makeHost();
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        [
          "src",
          "source",
          {
            source: "window",
            operation: "test.window",
            args: {},
            maxItems: 50,
          },
        ],
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 10, unit: "minutes" } },
        ],
        ["total", "combine", { mode: "count" }],
        [...count],
        ["done", "end", endWith("done")],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "pause"],
        ["pause", "done", "total"],
        ["total", "out", "post"],
        ["post", "out", "done"],
      ],
    });
    const { id } = await seedWorkflow(test, graph);
    test.operations.script("test.window", sourceResult(rows("w1", "w2")));
    test.operations.always("test.window", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    await ran(test, id);
    expect(await parkedAt(test, id, "w1")).toBe("pause");

    test.clock.set(minutesAfter(11));
    const second = await ran(test, id);
    test.clock.set(minutesAfter(30));
    const third = await ran(test, id);

    expect(second.run.counts).toMatchObject({ woke: 2 });
    expect(texts(test).filter((text) => text === "n=2")).toHaveLength(1);
    expect(await parkedAt(test, id, "w1")).toBeUndefined();
    expect(await parkedAt(test, id, "w2")).toBeUndefined();
    expect(third.run.counts).toMatchObject({ woke: 0 });
  });
});

describe("a hold that outlives what it was for", () => {
  async function heldRow(owner: string) {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([["digest", "combine", { mode: "list" }], [...lookup]], {
        source: INBOX,
      }),
    );
    offerRows(test, rows("a"));
    test.operations.always("test.read", ok({ v: 1 }));
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "an-earlier-run",
      now: T0,
    });
    await test.store.parkItem(test.scope, {
      workflowId: id,
      itemId: "a",
      leasedBy: "an-earlier-run",
      graphVersion: 1,
      nodeId: "look",
      wake: { wait: "retry", dueAt: minutesAfter(30) },
      context: {
        data: {},
        nodes: {},
        inbox: true,
        waitSince: T0,
        kept: [],
        heldBy: owner,
      },
    });
    return { test, id };
  }

  it("is let go when the list it was held for is gone, so the row is taken again", async () => {
    const { test, id } = await heldRow("list:digest:gone");

    test.clock.set(minutesAfter(31));
    const result = await ran(test, id);

    expect(result.run.counts).toMatchObject({ taken: 1 });
    expect(
      (await eventsOf(test, id, "a")).some((event) =>
        event.summary.includes("held for"),
      ),
    ).toBe(true);
  });

  it("stays held when the list it was held for is still waiting", async () => {
    const { test, id } = await heldRow("list:digest:waiting");
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["list:digest:waiting"],
      leasedBy: "an-earlier-run",
      now: T0,
    });
    await test.store.parkItem(test.scope, {
      workflowId: id,
      itemId: "list:digest:waiting",
      leasedBy: "an-earlier-run",
      graphVersion: 1,
      nodeId: "look",
      wake: { wait: "reply", dueAt: minutesAfter(24 * 60) },
      context: {
        data: {},
        nodes: {},
        inbox: false,
        members: ["a"],
        waitSince: T0,
        kept: [],
      },
    });

    test.clock.set(minutesAfter(31));
    const result = await ran(test, id);

    expect(result.run.counts).toMatchObject({ taken: 0 });
    const held = await stateOf(test, id, "a");
    expect(held?.parkedAtNode).toBe("look");
    expect(Date.parse(held?.wake?.dueAt ?? "")).toBeGreaterThan(
      Date.parse(minutesAfter(24 * 60)),
    );
  });
});
