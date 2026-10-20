import { describe, expect, it } from "vitest";

import { MAX_ITEM_CONTEXT_BYTES } from "../items.js";
import { buildGraph } from "../story-graphs.fixture.js";
import {
  EVERY_5M,
  T0,
  chain,
  endWith,
  eventsOf,
  last,
  minutesAfter,
  normalizedItem,
  providerQuery,
  ran,
  ranAt,
  sourceResult,
  stepOf,
} from "../testing/engine-fixtures.js";
import { aiPerItem, ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";

const assess = [
  "assess",
  "ai",
  {
    instruction: "Summarize this call",
    mode: "perItem",
    batchSize: 1,
    result: { summary: { type: "string" } },
  },
] as const;

const post = [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "path", path: "nodes.assess.summary" } },
  },
] as const;

const write = [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "hi" } },
  },
] as const;

const windowSource = {
  source: "window",
  operation: "test.window",
  args: {},
  maxItems: 50,
};

const calls = (count: number) =>
  Array.from({ length: count }, (_, index) => normalizedItem(`call-${index}`));

const askedAbout = (test: TestHost) =>
  test.ai.requests.flatMap((request) => request.items.map((item) => item.id));

const lastTrigger = async (test: TestHost, id: string) =>
  (await test.store.getWorkflow(test.scope, id))?.lastTriggerAt ?? null;

describe("a batch that does not fit one run", () => {
  it("makes progress every tick behind a window source and never asks the model about the same item twice", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...assess], [...post]], {
        source: windowSource,
        settings: { modelCallCap: 2 },
      }),
    );
    // A window is asked for what is new since the last run, so only the first tick has the five.
    test.operations.script("test.window", sourceResult(calls(5)));
    test.operations.always("test.window", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const first = await ran(test, id);

    // What the model finished goes on to the write in the same run.
    expect(first.run).toMatchObject({
      status: "paused",
      counts: { taken: 5, modelCalls: 2, setAside: 3 },
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(2);
    // Nothing the run took is lost, so the window moves on.
    expect(await lastTrigger(test, id)).not.toBeNull();
    expect(stepOf(first, "assess")).toMatchObject({
      status: "failed",
      error: { code: "ai_cap_reached" },
      fields: { deferred: 3 },
    });

    const second = await ran(test, id);
    const third = await ran(test, id);

    expect([first, second, third].map((tick) => tick.run.status)).toEqual([
      "paused",
      "paused",
      "succeeded",
    ]);
    expect(second.run.counts).toMatchObject({
      continued: 3,
      setAside: 1,
      modelCalls: 2,
    });
    expect(third.run.counts).toMatchObject({ continued: 1, modelCalls: 1 });
    expect(test.operations.callsTo("test.write")).toHaveLength(5);
    expect(askedAbout(test).sort()).toEqual(
      calls(5)
        .map((item) => item.id)
        .sort(),
    );
    for (const item of calls(5)) {
      const trail = (await eventsOf(test, id, item.id)).map(
        (event) => `${event.kind}:${event.outcome ?? ""}`,
      );
      expect(trail.filter((entry) => entry === "ended:done")).toHaveLength(1);
    }
  });

  it("does not spend an attempt on an item it set aside", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...assess], [...post]], {
        source: windowSource,
        settings: { modelCallCap: 1 },
      }),
    );
    test.operations.script("test.window", sourceResult(calls(2)));
    test.operations.always("test.window", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const first = await ran(test, id);

    const state = await test.store.getItemState(test.scope, id, "call-1");
    expect(state?.wake).toMatchObject({ wait: "retry" });
    expect(state?.parkedAtNode).toBe("assess");
    expect(state?.counters.attempts).toBeUndefined();
    expect(state?.context.continued).toBe(true);
    expect(first.run.counts).toMatchObject({
      itemFailures: 0,
      retryParked: 0,
      setAside: 1,
    });
    expect(
      (await eventsOf(test, id, "call-1")).find(
        (event) => event.kind === "parked",
      )?.summary,
    ).toContain('set aside at "assess"');
  });

  it("makes progress behind a cursor source too, and the cursor moves on once every item is accounted for", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...assess], [...post]], { settings: { modelCallCap: 2 } }),
    );
    test.operations.script(
      "test.items",
      sourceResult(calls(5), { cursor: "c1" }),
    );
    test.operations.always("test.items", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    await ran(test, id);
    expect(
      (
        await test.store.getSourceCursor(test.scope, {
          workflowId: id,
          nodeId: "src",
        })
      )?.value,
    ).toBe("c1");
    await ran(test, id);
    await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(5);
    expect(askedAbout(test)).toHaveLength(5);
    expect(test.statuses.written.map((entry) => entry.status)).toEqual(
      Array(5).fill("resolved"),
    );
  });

  it("holds a Combine back until the whole batch has come through, then runs it once", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [...assess],
          ["total", "combine", { mode: "count" }],
          [
            "post",
            "action",
            {
              operation: "test.write",
              args: { text: { mode: "fixed", value: "n={{ item.count }}" } },
            },
          ],
        ],
        { source: windowSource, settings: { modelCallCap: 2 } },
      ),
    );
    test.operations.script("test.window", sourceResult(calls(5)));
    test.operations.always("test.window", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const first = await ran(test, id);
    const second = await ran(test, id);

    // A count over the two it had would have said 2, then 4, and posted twice.
    expect(stepOf(first, "total")).toMatchObject({
      status: "skipped",
      fields: { reason: "waiting for the rest of its batch", deferred: 2 },
    });
    expect(stepOf(second, "total").status).toBe("skipped");
    expect(test.operations.callsTo("test.write")).toHaveLength(0);

    const third = await ran(test, id);

    expect(third.run.status).toBe("succeeded");
    expect(stepOf(third, "total").ports.out.count).toBe(1);
    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["n=5"]);
  });
});

describe("a batch bigger than one page of parked items", () => {
  it("comes back whole, so a Combine counts all of it", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [...assess],
          ["total", "combine", { mode: "count" }],
          [
            "post",
            "action",
            {
              operation: "test.write",
              args: { text: { mode: "fixed", value: "n={{ item.count }}" } },
            },
          ],
        ],
        { source: windowSource, settings: { modelCallCap: 30 } },
      ),
    );
    test.operations.script("test.window", sourceResult(calls(45)));
    test.operations.always("test.window", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const first = await ran(test, id);
    // 30 answered and waiting at the Combine, 15 waiting at the model: 45 parked, more than the 20 a page holds.
    expect(first.run.counts).toMatchObject({ setAside: 45 });
    const second = await ran(test, id);

    expect(second.run.status).toBe("succeeded");
    expect(second.run.counts).toMatchObject({ continued: 45 });
    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["n=45"]);
  });

  it("keeps a Combine from running while set-aside items are left behind a page of other due items", async () => {
    const test = makeHost();
    const graph = buildGraph({
      nodes: [
        ["start", "trigger", EVERY_5M],
        ["src", "source", providerQuery()],
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 60, unit: "minutes" } },
        ],
        ["total", "combine", { mode: "count" }],
        [
          "post",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "fixed", value: "n={{ item.count }}" } },
          },
        ],
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
    test.operations.script("test.items", sourceResult(calls(45)));
    test.operations.always("test.items", sourceResult([]));
    test.operations.always("test.write", ok({}, { externalRef: "m" }));
    await ranAt(test, id, T0);
    // A count over nothing says 0 on every tick; it is the later ones that must not say less than the batch.
    const writesBefore = test.operations.callsTo("test.write").length;
    // Three items a stopped run set aside at the Combine, due after the forty-five waiting at the Wait.
    for (const itemId of ["early-1", "early-2", "early-3"]) {
      await test.store.leaseItems(test.scope, {
        workflowId: id,
        graphVersion: 1,
        itemIds: [itemId],
        leasedBy: "an-earlier-run",
        now: T0,
      });
      await test.store.parkItem(test.scope, {
        workflowId: id,
        itemId,
        leasedBy: "an-earlier-run",
        graphVersion: 1,
        nodeId: "total",
        wake: { wait: "retry", dueAt: minutesAfter(61) },
        context: {
          data: { title: itemId },
          nodes: {},
          inbox: false,
          waitSince: T0,
          kept: ["item"],
          retryKind: "combine",
          continued: true,
        },
      });
    }

    const result = await ranAt(test, id, minutesAfter(62));

    // Two pages of Wait items hide the three, so a count now would be a count of part of the batch.
    expect(result.run).toMatchObject({
      status: "paused",
      error: { message: expect.stringContaining("needs a whole batch") },
    });
    expect(stepOf(result, "total")).toMatchObject({
      status: "skipped",
      fields: { reason: "waiting for the rest of its batch" },
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(writesBefore);
    expect(
      (await test.store.getItemState(test.scope, id, "early-1"))?.parkedAtNode,
    ).toBe("total");
  });
});

describe("a run that hits the soft deadline", () => {
  it("sets aside what is in flight, moves the window on, and the next tick finishes it with no effect repeated", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...write]], {
        source: windowSource,
        settings: { modelCallCap: 50 },
      }),
    );
    test.operations.script("test.window", sourceResult(calls(3)));
    test.operations.always("test.window", sourceResult([]));
    let deadlineAfterWrite = true;
    test.operations.always("test.write", async () => {
      if (deadlineAfterWrite) test.stopWhen(() => true);
      return ok({}, { externalRef: "m" });
    });

    const first = await ran(test, id);

    // One written; the deadline came before the other two, and before the End.
    expect(first.run.status).toBe("paused");
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(first.run.counts).toMatchObject({ taken: 3, setAside: 3 });
    expect(await lastTrigger(test, id)).not.toBeNull();
    for (const item of calls(3)) {
      expect(
        (await test.store.getItemState(test.scope, id, item.id))?.wake,
      ).toMatchObject({ wait: "retry" });
    }

    deadlineAfterWrite = false;
    test.stopWhen(() => false);
    const second = await ran(test, id);

    expect(second.run.status).toBe("succeeded");
    expect(second.run.counts).toMatchObject({ continued: 3 });
    expect(test.operations.callsTo("test.write")).toHaveLength(3);
    for (const item of calls(3)) {
      expect(
        (await eventsOf(test, id, item.id)).filter(
          (event) => event.kind === "ended",
        ),
      ).toHaveLength(1);
    }
  });

  it("leaves the window where it was when the deadline comes before a source has run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...write]], { source: windowSource }),
    );
    test.stopWhen(() => true);

    const result = await ran(test, id);

    expect(result.run.status).toBe("paused");
    expect(await lastTrigger(test, id)).toBeNull();
    expect(test.operations.callsTo("test.window")).toHaveLength(0);
  });
});

describe("a dry run that stops early", () => {
  it("says what it would set aside and stores nothing", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...assess], [...post]], {
        source: windowSource,
        settings: { modelCallCap: 1 },
      }),
    );
    test.operations.always("test.window", sourceResult(calls(2)));
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.status).toBe("paused");
    expect(result.run.counts.setAside).toBe(0);
    expect(
      (await test.store.getItemState(test.scope, id, "call-1"))?.wake,
    ).toBeUndefined();
    expect(
      (await eventsOf(test, id, "call-1")).find(
        (event) => event.kind === "parked",
      )?.summary,
    ).toContain("would set aside");
    expect(await lastTrigger(test, id)).toBeNull();
  });
});

describe("an item too big to be set aside", () => {
  it("is handed to a person and says why, never dropped", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [
            "read",
            "lookup",
            {
              operation: "test.read",
              args: { key: { mode: "fixed", value: "k" } },
            },
          ],
          [...assess],
        ],
        { settings: { modelCallCap: 1 } },
      ),
    );
    test.operations.script("test.items", sourceResult(calls(2)));
    test.operations.always(
      "test.read",
      ok({ transcript: "x".repeat(MAX_ITEM_CONTEXT_BYTES + 1000) }),
    );
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const first = await ran(test, id);

    expect(first.run.counts).toMatchObject({ needsManual: 1, itemFailures: 1 });
    const events = await eventsOf(test, id, "call-1");
    expect(events.find((event) => event.kind === "error")).toMatchObject({
      code: "context_truncated",
    });
    expect(last(events)).toMatchObject({
      kind: "ended",
      outcome: "needsManual",
    });
  });
});
