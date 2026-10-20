import { describe, expect, it } from "vitest";

import { MAX_STEP_OUTPUT_BYTES } from "../../items.js";
import {
  chain,
  endWith,
  eventsOf,
  normalizedItem,
  providerQuery,
  putBackRowsFor,
  ran,
  sourceResult,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { failure, ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const items = (count: number, prefix = "m") =>
  Array.from({ length: count }, (_, index) =>
    normalizedItem(`${prefix}${index}`),
  );

async function setup(source: Record<string, unknown> = providerQuery()) {
  const test = makeHost();
  const workflow = await seedWorkflow(test, chain([], { source }));
  return { test, id: workflow.id };
}

describe("a provider-query source", () => {
  it("takes its items, leases them, and records one taken event each", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id);

    const step = stepOf(result, "src");
    expect(step.status).toBe("succeeded");
    expect(step.ports.out).toEqual({ count: 2, itemIds: ["m0", "m1"] });
    expect(step.fields).toMatchObject({ source: "provider-query", taken: 2 });
    expect((await eventsOf(test, id, "m0"))[0]).toMatchObject({
      kind: "taken",
      nodeId: "src",
      port: "out",
      mode: "live",
    });
    expect(result.run.counts.taken).toBe(2);
  });

  it("passes the limit and credential slot, and the window's own dates", async () => {
    const { test, id } = await setup({
      source: "window",
      operation: "test.window",
      args: {},
      maxItems: 7,
    });
    test.operations.script("test.window", sourceResult([]));

    await ran(test, id);

    const [call] = test.operations.calls;
    expect(call).toMatchObject({
      credentialSlot: "test",
      mode: "live",
      limit: 7,
      fields: {
        since: "2026-10-19T11:55:00.000Z",
        until: "2026-10-19T12:00:00.000Z",
      },
    });
  });

  it("starts the next window where the last live run ended", async () => {
    const { test, id } = await setup({
      source: "window",
      operation: "test.window",
      args: {},
      maxItems: 7,
    });
    test.operations.always("test.window", sourceResult([]));
    await ran(test, id, { scheduledFor: "2026-10-19T12:00:00.000Z" });

    await ran(test, id, { scheduledFor: "2026-10-19T12:05:00.000Z" });

    expect(test.operations.calls[1].fields).toMatchObject({
      since: "2026-10-19T12:00:00.000Z",
      until: "2026-10-19T12:05:00.000Z",
    });
  });

  it("takes at most its bound and records how many there were", async () => {
    const { test, id } = await setup(providerQuery({ maxItems: 5 }));
    test.operations.script("test.items", sourceResult(items(8)));

    const result = await ran(test, id);

    const step = stepOf(result, "src");
    expect(step.ports.out.count).toBe(5);
    expect(step.truncated).toEqual({ totalAvailable: 8 });
    expect(step.fields).toMatchObject({ cutBy: "count" });
    expect(result.run.status).toBe("succeeded");
  });

  it("records the provider's own total when it paged, and still moves the cursor it covers", async () => {
    const { test, id } = await setup(providerQuery({ maxItems: 5 }));
    test.operations.script(
      "test.items",
      sourceResult(items(5), { totalAvailable: 340, cursor: "page-2" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "src").truncated).toEqual({ totalAvailable: 340 });
    expect(stepOf(result, "src").fields).toMatchObject({ cutBy: "provider" });
    expect(
      (
        await test.store.getSourceCursor(test.scope, {
          workflowId: id,
          nodeId: "src",
        })
      )?.value,
    ).toBe("page-2");
  });

  it("takes only the items that fit a step's bytes, and says it cut", async () => {
    const { test, id } = await setup(providerQuery({ maxItems: 50 }));
    const heavy = Array.from({ length: 30 }, (_, index) =>
      normalizedItem(`h${index}`, { extras: { blob: "x".repeat(4000) } }),
    );
    test.operations.script(
      "test.items",
      sourceResult(heavy, { cursor: "past-all" }),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "src");
    expect(step.ports.out.count).toBeGreaterThan(5);
    expect(step.ports.out.count).toBeLessThan(30);
    expect(step.truncated).toEqual({ totalAvailable: 30 });
    expect(step.fields).toMatchObject({ cutBy: "bytes" });
    expect(result.run.status).toBe("succeeded");
  });

  it("fails the step when one item alone cannot fit", async () => {
    const { test, id } = await setup();
    const huge = normalizedItem("huge", {
      extras: { blob: "x".repeat(MAX_STEP_OUTPUT_BYTES) },
    });
    test.operations.script("test.items", sourceResult([huge], { cursor: "c" }));

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: { code: "output_over_cap" },
    });
    expect(result.run).toMatchObject({
      status: "failed",
      error: { code: "output_over_cap" },
    });
    expect(
      await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "src",
      }),
    ).toBeNull();
  });
});

describe("a source's cursor", () => {
  const cursorOf = (
    test: Awaited<ReturnType<typeof setup>>["test"],
    id: string,
  ) =>
    test.store.getSourceCursor(test.scope, { workflowId: id, nodeId: "src" });

  it("is saved once the step succeeds, and handed back on the next run", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult(items(1), { cursor: "c1" }),
    );
    await ran(test, id);
    expect((await cursorOf(test, id))?.value).toBe("c1");

    test.operations.script("test.items", sourceResult([], { cursor: "c2" }));
    await ran(test, id);

    expect(test.operations.calls[1].fields).toMatchObject({ after: "c1" });
    expect((await cursorOf(test, id))?.value).toBe("c2");
  });

  it("is not saved when the step fails, so the same items are offered again", async () => {
    const { test, id } = await setup();
    const bad = { ...normalizedItem("m0"), title: "" };
    test.operations.script("test.items", sourceResult([bad], { cursor: "c1" }));

    const result = await ran(test, id);

    expect(stepOf(result, "src").status).toBe("failed");
    expect(await cursorOf(test, id)).toBeNull();
  });

  it("is held when the engine had to drop items the cursor already covers", async () => {
    const { test, id } = await setup(providerQuery({ maxItems: 2 }));
    test.operations.script(
      "test.items",
      sourceResult(items(4), { cursor: "past-all-four" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "src").fields).toMatchObject({
      cursorHeld: "items past the bound were not taken",
    });
    expect(await cursorOf(test, id)).toBeNull();
  });

  it("is held, and the run still succeeds, when a run that completed dropped items", async () => {
    const { test, id } = await setup(providerQuery({ maxItems: 2 }));
    test.operations.script(
      "test.items",
      sourceResult(items(4), { cursor: "past-all-four" }),
    );

    const result = await ran(test, id);

    expect(result.run.status).toBe("succeeded");
    expect(stepOf(result, "src").fields).toMatchObject({
      cursorHeld: "items past the bound were not taken",
    });
    expect(await cursorOf(test, id)).toBeNull();
  });

  it("is not saved in a dry run", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult(items(1), { cursor: "c1" }),
    );

    await ran(test, id, { mode: "dry" });

    expect(await cursorOf(test, id)).toBeNull();
  });

  it("is not saved when a later step fails: what the source took would be stranded", async () => {
    const test = makeHost();
    const graph = chain([
      [
        "read",
        "lookup",
        {
          operation: "test.read",
          args: { key: { mode: "path", path: "item.title" } },
        },
      ],
    ]);
    const { id } = await seedWorkflow(test, graph);
    test.operations.script(
      "test.items",
      sourceResult(items(3), { cursor: "c1" }),
    );
    const big = { ok: true as const, output: { blob: "x".repeat(30_000) } };
    test.operations.script("test.read", big, big, big);

    const failed = await ran(test, id);

    expect(failed.run).toMatchObject({
      status: "failed",
      error: { code: "output_over_cap" },
    });
    expect(await cursorOf(test, id)).toBeNull();
  });

  it("is saved when the run pauses with everything the source took set aside for the next tick, and not before", async () => {
    const test = makeHost();
    const graph = chain([
      [
        "read",
        "lookup",
        {
          operation: "test.read",
          args: { key: { mode: "path", path: "item.title" } },
        },
      ],
    ]);
    const { id } = await seedWorkflow(test, graph);
    test.operations.script("test.items", async () => {
      test.stopWhen(() => true);
      return sourceResult(items(1), { cursor: "c2" });
    });

    const paused = await ran(test, id);

    expect(paused.run.status).toBe("paused");
    expect(stepOf(paused, "src").status).toBe("succeeded");
    // The item waits at the node that did not run, so the cursor may move past it.
    expect(await test.store.getItemState(test.scope, id, "m0")).toMatchObject({
      parkedAtNode: "read",
    });
    expect((await cursorOf(test, id))?.value).toBe("c2");
  });

  it("is not saved when the run pauses before the source has run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.stopWhen(() => true);

    const paused = await ran(test, id);

    expect(paused.run.status).toBe("paused");
    expect(test.operations.callsTo("test.items")).toHaveLength(0);
    expect(await cursorOf(test, id)).toBeNull();
  });

  it("is saved only after every node has run", async () => {
    const test = makeHost();
    const graph = chain([
      [
        "read",
        "lookup",
        {
          operation: "test.read",
          args: { key: { mode: "path", path: "item.title" } },
        },
      ],
    ]);
    const { id } = await seedWorkflow(test, graph);
    test.operations.script(
      "test.items",
      sourceResult(items(1), { cursor: "c1" }),
    );
    let seenDuringLookup: string | undefined = "unset";
    test.operations.script("test.read", async () => {
      seenDuringLookup = (await cursorOf(test, id))?.value;
      return ok({ n: 1 });
    });

    await ran(test, id);

    expect(seenDuringLookup).toBeUndefined();
    expect((await cursorOf(test, id))?.value).toBe("c1");
  });
});

describe("an inbox source", () => {
  it("asks the inbox for its poller and marks its items as inbox rows", async () => {
    const { test, id } = await setup({
      source: "inbox-poll",
      poller: "slack",
      takeLimit: 5,
      filter: { scopes: ["C1"] },
    });
    test.inbox.script("inbox-poll", { ok: true, items: items(2) });

    const result = await ran(test, id);

    expect(test.inbox.requests[0]).toMatchObject({
      mode: "live",
      settings: { source: "inbox-poll", poller: "slack", takeLimit: 5 },
    });
    expect(stepOf(result, "src").ports.out.count).toBe(2);
    // The End node moves inbox rows to a status: both items were written.
    expect(test.statuses.written.map((entry) => entry.itemId)).toEqual([
      "m0",
      "m1",
    ]);
  });

  it("reads items in a status the same way", async () => {
    const { test, id } = await setup({
      source: "status",
      status: "automation_started",
      takeLimit: 10,
    });
    test.inbox.script("status", { ok: true, items: items(1) });

    const result = await ran(test, id);

    expect(test.inbox.requests[0].settings).toMatchObject({
      source: "status",
      status: "automation_started",
    });
    expect(stepOf(result, "src").ports.out.count).toBe(1);
  });

  it("takes only its bound from a longer list", async () => {
    const { test, id } = await setup({
      source: "status",
      status: "automation_started",
      takeLimit: 3,
    });
    test.inbox.script("status", {
      ok: true,
      items: items(5),
      totalAvailable: 9,
    });

    const result = await ran(test, id);

    expect(stepOf(result, "src").ports.out.count).toBe(3);
    expect(stepOf(result, "src").truncated).toEqual({ totalAvailable: 9 });
  });

  it("fails the run on an inbox failure and skips what comes after", async () => {
    const { test, id } = await setup({
      source: "status",
      status: "automation_started",
      takeLimit: 3,
    });
    test.inbox.script("status", {
      ok: false,
      code: "provider_error",
      message: "inbox down",
      retryable: false,
    });

    const result = await ran(test, id);

    expect(result.run).toMatchObject({
      status: "failed",
      error: { code: "provider_error", message: "inbox down" },
    });
    expect(stepOf(result, "done")).toMatchObject({ status: "skipped" });
  });
});

describe("a source that fails", () => {
  it("fails its step and the run, and records the later nodes as skipped", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      failure("credential_missing", { message: "Connect Slack" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: { code: "credential_missing", message: "Connect Slack" },
    });
    expect(stepOf(result, "done")).toMatchObject({
      status: "skipped",
      fields: { reason: '"src" failed' },
    });
    expect(result.run.status).toBe("failed");
    expect(result.clean).toBe(false);
  });

  it("retries a failure that did nothing and may pass, waiting through the clock", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      failure("provider_error", { retryable: true }),
      failure("provider_error", { retryable: true }),
      sourceResult(items(1)),
    );

    const result = await ran(test, id);

    expect(test.clock.sleeps).toEqual([1000, 4000]);
    expect(test.operations.callsTo("test.items")).toHaveLength(3);
    expect(result.run.status).toBe("succeeded");
  });

  it("gives up after the retries and fails the run", async () => {
    const { test, id } = await setup();
    test.operations.always(
      "test.items",
      failure("provider_error", { retryable: true }),
    );

    const result = await ran(test, id);

    expect(test.operations.callsTo("test.items")).toHaveLength(3);
    expect(result.run.status).toBe("failed");
  });

  it("does not retry a failure that is not retryable", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      failure("provider_error", { retryable: false }),
    );

    await ran(test, id);

    expect(test.operations.callsTo("test.items")).toHaveLength(1);
    expect(test.clock.sleeps).toEqual([]);
  });

  it.each([
    [
      "an item that is not a normalized item",
      [{ ...normalizedItem("m0"), title: "" }],
      /Item 0 is not a valid item: title/,
    ],
    [
      "two items with one id",
      [normalizedItem("dup"), normalizedItem("dup")],
      /repeats the id "dup"/,
    ],
  ])(
    "fails the step with item_invalid for %s",
    async (_name, list, message) => {
      const { test, id } = await setup();
      test.operations.script("test.items", sourceResult(list));

      const result = await ran(test, id);

      expect(stepOf(result, "src")).toMatchObject({
        status: "failed",
        error: {
          code: "item_invalid",
          message: expect.stringMatching(message),
        },
      });
    },
  );

  it("does not read a missing list as an empty one", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", { ok: true, output: null });

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: { code: "item_invalid" },
    });
  });

  it("fails with graph_invalid when it is fed items, since it takes no input", async () => {
    const test = makeHost();
    const graph = chain([["second", "source", providerQuery()]]);
    const { id } = await seedWorkflow(test, graph);
    test.operations.always("test.items", sourceResult(items(1)));

    const result = await ran(test, id);

    expect(stepOf(result, "second")).toMatchObject({
      status: "failed",
      error: { code: "graph_invalid" },
    });
  });

  it("leaves an item another run holds alone, and says how many it skipped", async () => {
    const { test, id } = await setup();
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["m1"],
      leasedBy: "another-run",
      now: test.clock.now().toISOString(),
    });
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id);

    const step = stepOf(result, "src");
    expect(step.ports.out).toEqual({ count: 1, itemIds: ["m0"] });
    expect(step.fields).toMatchObject({ heldByAnotherRun: 1 });
  });
});

describe("the rows a provider query stores", () => {
  const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

  it("gives every item a row before the End moves it, so each ends resolved", async () => {
    const { test, id } = await setup();
    test.statuses.requireRows();
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id);

    expect(result.run.counts).toMatchObject({ done: 2, itemFailures: 0 });
    expect(result.run.status).toBe("succeeded");
    expect([...test.statuses.rows.keys()]).toEqual(["m0", "m1"]);
    expect(test.statuses.statusOf("m0")).toBe("resolved");
    expect(test.statuses.statusOf("m1")).toBe("resolved");
    expect(stepOf(result, "src").fields).toMatchObject({
      rows: { inserted: 2, updated: 0, unchanged: 0, skipped: 0 },
    });
  });

  it("stores the bounded item the next node reads, not the provider's whole answer", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult([
        normalizedItem("m0", {
          text: "x".repeat(5000),
          payload: { blob: "y".repeat(5000) },
        }),
      ]),
    );

    await ran(test, id);

    const [stored] = test.statuses.upserts[0];
    expect(stored).toMatchObject({
      id: "m0",
      textTruncated: true,
      payloadTruncated: true,
    });
    expect(JSON.stringify(stored.payload).length).toBeLessThan(2100);
  });

  it("stores only what it took when a step cannot hold them all", async () => {
    const { test, id } = await setup(providerQuery({ maxItems: 2 }));
    test.operations.script("test.items", sourceResult(items(4)));

    await ran(test, id);

    expect(test.statuses.upserts.map(ids)).toEqual([["m0", "m1"]]);
  });

  it("writes no row in a dry run, and the End says which status it would set", async () => {
    const { test, id } = await setup();
    test.statuses.requireRows();
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id, { mode: "dry" });

    expect(test.statuses.upserts).toEqual([]);
    expect(test.statuses.rows.size).toBe(0);
    expect(test.statuses.written).toEqual([]);
    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts).toMatchObject({ done: 2, itemFailures: 0 });
    expect(stepOf(result, "src").fields).toMatchObject({
      rowsHeld: "not a live run",
    });
    expect(stepOf(result, "src").fields).not.toHaveProperty("rows");
    expect(stepOf(result, "done").fields).toMatchObject({
      wouldSetStatus: "resolved",
    });
  });

  it("writes no row in a test run", async () => {
    const test = makeHost();
    test.statuses.requireRows();
    const { id } = await seedWorkflow(test, chain([]));

    await ran(test, id, {
      mode: "test",
      testNodeId: "done",
      sampleItems: [{ id: "s1", item: { title: "sample" } }],
    });

    expect(test.statuses.upserts).toEqual([]);
    expect(test.statuses.rows.size).toBe(0);
  });

  it("stores nothing for a query that keeps its items inline, or for a window", async () => {
    const inline = await setup(providerQuery({ memory: "none" }));
    inline.test.operations.script("test.items", sourceResult(items(2)));
    await ran(inline.test, inline.id);
    expect(inline.test.statuses.upserts).toEqual([]);

    const window = await setup({
      source: "window",
      operation: "test.window",
      args: {},
      maxItems: 7,
    });
    window.test.operations.script("test.window", sourceResult(items(2)));
    await ran(window.test, window.id);
    expect(window.test.statuses.upserts).toEqual([]);
  });

  it("does not store anything when the provider sent nothing", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", sourceResult([]));

    const result = await ran(test, id);

    expect(test.statuses.upserts).toEqual([]);
    expect(stepOf(result, "src").status).toBe("succeeded");
  });

  it("fails the step, takes no item and holds the cursor when the rows cannot be stored", async () => {
    const { test, id } = await setup();
    test.statuses.refuseNextUpsert("storage is down", false);
    test.operations.script(
      "test.items",
      sourceResult(items(2), { cursor: "c1" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: {
        code: "provider_error",
        message: expect.stringContaining("storage is down"),
      },
    });
    expect(result.run.status).toBe("failed");
    expect(result.run.counts).toMatchObject({ taken: 0, done: 0 });
    expect(test.statuses.written).toEqual([]);
    expect(
      await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "src",
      }),
    ).toBeNull();
    expect(
      (await test.store.getItemState(test.scope, id, "m0"))?.leasedBy,
    ).toBe(undefined);
  });

  it("retries a store that failed and may pass", async () => {
    const { test, id } = await setup();
    test.statuses.refuseNextUpsert("busy", true);
    test.operations.script("test.items", sourceResult(items(1)));

    const result = await ran(test, id);

    expect(test.clock.sleeps).toEqual([1000]);
    expect(test.statuses.upserts.map(ids)).toEqual([["m0"]]);
    expect(result.run.status).toBe("succeeded");
  });
});

describe("an inbox poll in a dry run", () => {
  it("says it ingested, because the poller behind it writes rows in every mode", async () => {
    for (const mode of ["live", "dry"] as const) {
      const { test, id } = await setup({
        source: "inbox-poll",
        poller: "slack",
        takeLimit: 5,
      });
      test.inbox.script("inbox-poll", { ok: true, items: items(1) });

      const result = await ran(test, id, { mode });

      expect(stepOf(result, "src").fields).toMatchObject({
        source: "inbox-poll",
        ingested: true,
      });
      expect(test.inbox.requests[0].mode).toBe(mode);
    }
  });

  it("does not say so for a status read, which polls nothing", async () => {
    const { test, id } = await setup({
      source: "status",
      status: "automation_started",
      takeLimit: 10,
    });
    test.inbox.script("status", { ok: true, items: items(1) });

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "src").fields).not.toHaveProperty("ingested");
  });
});

describe("an item the inbox already handled", () => {
  const handledRun = async (
    end: ReturnType<typeof endWith> = endWith("done"),
    source: Record<string, unknown> = providerQuery(),
  ) => {
    const test = makeHost();
    test.statuses.requireRows();
    const { id } = await seedWorkflow(test, chain([], { source, end }));
    return { test, id };
  };

  it.each([
    ["done", endWith("done"), "resolved"],
    ["dismissed", endWith("dismissed"), "dismissed"],
    ["needsManual", endWith("needsManual"), "needs_manual"],
  ] as const)(
    "is not taken again on the next tick once it ended %s",
    async (_name, end, status) => {
      const { test, id } = await handledRun(end);
      test.operations.always("test.items", sourceResult(items(2)));

      const first = await ran(test, id);
      const second = await ran(test, id);

      expect(first.run.counts).toMatchObject({ taken: 2 });
      expect(test.statuses.rowStatus.get("m0")).toBe(status);
      expect(second.run.counts).toMatchObject({
        taken: 0,
        done: 0,
        dismissed: 0,
        needsManual: 0,
      });
      const step = stepOf(second, "src");
      expect(step.ports.out).toEqual({ count: 0, itemIds: [] });
      expect(step.fields).toMatchObject({ taken: 0, alreadyHandled: 2 });
      // Nothing was written for them again: no second status, no second taken event.
      expect(test.statuses.written).toHaveLength(2);
      expect(
        (await eventsOf(test, id, "m0")).filter(
          (event) => event.kind === "taken",
        ),
      ).toHaveLength(1);
    },
  );

  it("takes an item that was released, which goes back to its queue", async () => {
    const { test, id } = await handledRun(endWith("released"));
    test.operations.always("test.items", sourceResult(items(2)));

    await ran(test, id);
    const second = await ran(test, id);

    expect(second.run.counts).toMatchObject({ taken: 2, released: 2 });
    expect(stepOf(second, "src").fields).toMatchObject({ alreadyHandled: 0 });
    expect(test.statuses.upserts).toHaveLength(2);
  });

  it("takes an item a person put back in the queue", async () => {
    const { test, id } = await handledRun();
    test.operations.always("test.items", sourceResult(items(2)));
    await ran(test, id);
    test.statuses.rowStatus.set("m1", "received");

    const second = await ran(test, id);

    expect(stepOf(second, "src").ports.out.itemIds).toEqual(["m1"]);
    expect(stepOf(second, "src").fields).toMatchObject({
      taken: 1,
      alreadyHandled: 1,
    });
  });

  it("takes the new items of a list and leaves the handled ones, and does not lease the handled", async () => {
    const { test, id } = await handledRun();
    test.statuses.seedRow(normalizedItem("old"), "resolved");
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("old"), normalizedItem("new")]),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "src");
    expect(step.ports.out).toEqual({ count: 1, itemIds: ["new"] });
    expect(step.fields).toMatchObject({
      taken: 1,
      alreadyHandled: 1,
      rows: { inserted: 1, unchanged: 1 },
    });
    expect(await test.store.getItemState(test.scope, id, "old")).toBeNull();
    expect(test.statuses.statusOf("old")).toBeUndefined();
    expect(result.run.counts).toMatchObject({ taken: 1, done: 1 });
  });

  it("still moves the cursor over items it left out, since they were handled and are not stranded", async () => {
    const { test, id } = await handledRun();
    test.statuses.seedRow(normalizedItem("m0"), "resolved");
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("m0")], { cursor: "c1" }),
    );

    await ran(test, id);

    expect(
      (
        await test.store.getSourceCursor(test.scope, {
          workflowId: id,
          nodeId: "src",
        })
      )?.value,
    ).toBe("c1");
  });

  it("does not hand a downstream node an empty list as if something arrived", async () => {
    const { test, id } = await handledRun();
    test.statuses.seedRow(normalizedItem("m0"), "dismissed");
    test.operations.script("test.items", sourceResult([normalizedItem("m0")]));

    const result = await ran(test, id);

    expect(stepOf(result, "done").ports).toEqual({});
    expect(result.run.status).toBe("succeeded");
  });

  it("is not applied to a status source, which reads items that are meant to be read again", async () => {
    const { test, id } = await handledRun(endWith("released"), {
      source: "status",
      status: "automation_started",
      takeLimit: 10,
    });
    test.statuses.seedRow(normalizedItem("m0"), "resolved");
    test.inbox.always("status", { ok: true, items: items(1) });

    await ran(test, id);
    const second = await ran(test, id);

    expect(stepOf(second, "src").ports.out.itemIds).toEqual(["m0"]);
    expect(stepOf(second, "src").fields).not.toHaveProperty("alreadyHandled");
    expect(test.statuses.upserts).toEqual([]);
    expect(test.statuses.checks).toEqual([]);
  });

  it("is not applied to an inbox poll or a window either", async () => {
    const poll = await handledRun(endWith("released"), {
      source: "inbox-poll",
      poller: "slack",
      takeLimit: 5,
    });
    poll.test.statuses.seedRow(normalizedItem("m0"), "resolved");
    poll.test.inbox.always("inbox-poll", { ok: true, items: items(1) });
    const polled = await ran(poll.test, poll.id);
    expect(stepOf(polled, "src").ports.out.itemIds).toEqual(["m0"]);

    const window = await handledRun(endWith("released"), {
      source: "window",
      operation: "test.window",
      args: {},
      maxItems: 5,
    });
    window.test.statuses.seedRow(normalizedItem("m0"), "resolved");
    window.test.operations.always("test.window", sourceResult(items(1)));
    const windowed = await ran(window.test, window.id);
    expect(stepOf(windowed, "src").ports.out.itemIds).toEqual(["m0"]);
    expect(stepOf(windowed, "src").fields).not.toHaveProperty("alreadyHandled");
  });

  it("is reported the same way in a dry run, which writes nothing", async () => {
    const { test, id } = await handledRun();
    const old = normalizedItem("old", { title: "Stored before" });
    test.statuses.seedRow(old, "resolved");
    test.operations.script(
      "test.items",
      sourceResult([
        normalizedItem("old", { title: "Edited since" }),
        normalizedItem("new"),
      ]),
    );

    const result = await ran(test, id, { mode: "dry" });

    const step = stepOf(result, "src");
    expect(step.ports.out).toEqual({ count: 1, itemIds: ["new"] });
    expect(step.fields).toMatchObject({
      taken: 1,
      alreadyHandled: 1,
      rowsHeld: "not a live run",
    });
    expect(step.fields).not.toHaveProperty("rows");
    expect(test.statuses.upserts).toEqual([]);
    expect(test.statuses.checks).toHaveLength(1);
    // The stored row is as it was left, and no row appeared for the new item.
    expect(test.statuses.rows.get("old")).toBe(old);
    expect(test.statuses.rows.has("new")).toBe(false);
    expect(test.statuses.written).toEqual([]);
  });

  it("records a count of none when nothing was handled, so the audit has a number to show", async () => {
    const { test, id } = await handledRun();
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id);

    expect(stepOf(result, "src").fields).toMatchObject({ alreadyHandled: 0 });
  });

  it("fails the step, and takes nothing, when the store does not say where an item stands", async () => {
    const { test, id } = await handledRun();
    test.statuses.upsertItems = async () => ({
      ok: true,
      inserted: 2,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      states: [{ id: "m0", state: "created" }],
    });
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: {
        code: "engine_error",
        message: expect.stringContaining('"m1"'),
      },
    });
    expect(result.run.counts).toMatchObject({ taken: 0, done: 0 });
    expect(test.statuses.written).toEqual([]);
  });
});

describe("rows a provider sent that the host could not read", () => {
  it("are counted on the step and the run, so a run that skipped some is not read as a clean one", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult(items(2), {
        output: { itemCount: 2, truncated: false, skippedRows: 3 },
      }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "needs_check",
      fields: { skippedRows: 3, taken: 2 },
      error: { code: "partial_read" },
    });
    // What Activity says of the run: two taken, and three rows to check.
    expect(result.run.counts).toMatchObject({
      taken: 2,
      skippedRows: 3,
      needsCheck: 3,
    });
    expect(result.run.status).toBe("succeeded");
    expect(result.clean).toBe(false);
  });

  it("are not made up when the host said nothing about them", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", sourceResult(items(2)));

    const result = await ran(test, id);

    expect(stepOf(result, "src").fields).not.toHaveProperty("skippedRows");
    expect(result.run.counts).toMatchObject({ skippedRows: 0, needsCheck: 0 });
    expect(result.clean).toBe(true);
  });

  it("are not read as none when the host's count is not a count", async () => {
    const { test, id } = await setup();
    test.operations.script(
      "test.items",
      sourceResult(items(1), { output: { skippedRows: "some" } }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: { code: "engine_error" },
    });
  });
});

describe("rows put back in the queue under a source whose provider has moved on", () => {
  const lookup = [
    "look",
    "lookup",
    { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
  ] as const;

  async function handedToAPerson() {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...lookup]]));
    putBackRowsFor(test, id);
    // The provider offers the item once; its cursor has passed it after that.
    test.operations.script("test.items", sourceResult(items(1)));
    test.operations.always("test.items", sourceResult([]));
    test.operations.script("test.read", failure("lookup_failed"));
    test.operations.always("test.read", ok({ v: 1 }));
    const first = await ran(test, id);
    expect(first.run.counts).toMatchObject({ taken: 1, needsManual: 1 });
    expect(test.statuses.rowStatus.get("m0")).toBe("needs_manual");
    return { test, id };
  }

  it("takes an item a person sent back, once, though its provider will not offer it again", async () => {
    const { test, id } = await handedToAPerson();
    // What requeueing does: the row goes back to its queue status and its attempts clear.
    test.statuses.seedRow(items(1)[0], "received");
    await test.store.clearCounters(test.scope, {
      workflowId: id,
      itemId: "m0",
      counters: ["attempts"],
    });

    const second = await ran(test, id);
    const third = await ran(test, id);

    expect(second.run.counts).toMatchObject({ taken: 1, done: 1 });
    expect(stepOf(second, "src").fields).toMatchObject({
      taken: 1,
      requeued: 1,
    });
    expect(test.statuses.rowStatus.get("m0")).toBe("resolved");
    expect(test.operations.callsTo("test.read")).toHaveLength(2);
    // Handled, so it is not read again.
    expect(third.run.counts).toMatchObject({ taken: 0 });
    expect(stepOf(third, "src").fields).not.toHaveProperty("requeued");
  });

  it("does not take it while it is still with a person", async () => {
    const { test, id } = await handedToAPerson();

    const second = await ran(test, id);

    expect(second.run.counts).toMatchObject({ taken: 0 });
  });

  it("does not store it again, or take it twice when the provider offers it as well", async () => {
    const { test, id } = await handedToAPerson();
    test.statuses.seedRow(items(1)[0], "received");
    test.operations.script("test.items", sourceResult(items(2)));
    const stored = test.statuses.upserts.length;

    const second = await ran(test, id);

    expect(stepOf(second, "src").ports.out.itemIds).toEqual(["m0", "m1"]);
    // Only what the provider sent that was not already a row is stored.
    expect(test.statuses.upserts.slice(stored)).toEqual([
      [expect.objectContaining({ id: "m1" })],
    ]);
  });

  it("puts them ahead of the provider's rows and within the source's own bound", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([], { source: providerQuery({ maxItems: 2 }) }),
    );
    putBackRowsFor(test, id);
    for (const row of items(3, "q")) {
      test.statuses.seedRow(row, "received");
      await test.store.leaseItems(test.scope, {
        workflowId: id,
        graphVersion: 1,
        itemIds: [row.id],
        leasedBy: "earlier",
        now: "2026-10-19T10:00:00.000Z",
        ttlMs: 1000,
      });
    }
    test.operations.script(
      "test.items",
      sourceResult(items(2, "p"), { cursor: "c1" }),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "src");
    expect(step.ports.out.itemIds).toEqual(["q0", "q1"]);
    expect(step.fields).toMatchObject({ requeued: 2, cutBy: "count" });
    // The provider's rows did not fit, so its cursor stays where it was.
    expect(step.fields?.cursorHeld).toBeDefined();
  });

  it("is asked only of a source that keeps its items in the inbox", async () => {
    const { test, id } = await setup({
      source: "window",
      operation: "test.window",
      args: {},
      maxItems: 5,
    });
    test.operations.script("test.window", sourceResult(items(1)));

    await ran(test, id);

    expect(test.inbox.requeuedRequests).toEqual([]);
  });

  it("fails the step when the read does, instead of reading it as nothing put back", async () => {
    const { test, id } = await setup();
    test.inbox.requeued(async () => ({
      ok: false,
      code: "provider_error",
      message: "the inbox could not be read",
      retryable: false,
    }));
    test.operations.script("test.items", sourceResult(items(1)));

    const result = await ran(test, id);

    expect(stepOf(result, "src")).toMatchObject({
      status: "failed",
      error: { code: "provider_error" },
    });
    expect(result.run.counts).toMatchObject({ taken: 0 });
  });

  it("is read in a dry run too, so a dry run shows what a live one would take", async () => {
    const { test, id } = await setup();
    test.inbox.requeued(async () => ({ ok: true, items: items(1, "q") }));
    test.operations.script("test.items", sourceResult(items(1)));

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "src").ports.out.itemIds).toEqual(["q0", "m0"]);
    expect(test.statuses.upserts).toEqual([]);
  });
});
