import { describe, expect, it } from "vitest";

import type { RunRecord } from "../adapter.js";
import { WorkflowStoreError } from "../adapter.js";
import { chain, startedByHand } from "../testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";
import { createTickContext } from "./tick-context.js";
import type { FlowItem, RunWindow } from "./types.js";

const window: RunWindow = {
  start: "2026-10-19T11:55:00.000Z",
  end: "2026-10-19T12:00:00.000Z",
  firstRun: false,
};

const flow = (id: string, over: Partial<FlowItem> = {}): FlowItem => ({
  id,
  data: { title: id },
  nodes: {},
  inbox: true,
  ...over,
});

async function runtimeFor(mode: "live" | "dry" = "live") {
  const test = makeHost();
  const graph = chain([]);
  const workflow = await seedWorkflow(test, graph);
  const started = await test.store.startRun(test.scope, {
    workflowId: workflow.id,
    tickKey: "tick-1",
    mode,
    ...startedByHand(mode),
    graphVersion: 1,
  });
  const run: RunRecord = started.run;
  const ctx = createTickContext({
    host: test.host,
    scope: test.scope,
    workflowId: workflow.id,
    ownerEmail: "owner@example.test",
    graph,
    graphVersion: 1,
    run,
    mode,
    window,
    scheduledFor: null,
  });
  return { test, id: workflow.id, runtime: ctx.runtime };
}

describe("ItemRuntime in a live run", () => {
  it("leases the items it can take and reports the ones another run holds", async () => {
    const { test, id, runtime } = await runtimeFor();
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["b"],
      leasedBy: "other",
      now: test.clock.now().toISOString(),
    });

    const { won, skipped } = await runtime.lease([flow("a"), flow("b")]);

    expect(won.map((item) => item.id)).toEqual(["a"]);
    expect(skipped.map((item) => item.id)).toEqual(["b"]);
    expect(runtime.taken).toBe(1);
    expect((await test.store.getItemState(test.scope, id, "a"))?.leasedBy).toBe(
      "lease-1",
    );
  });

  it("counts on the store, and starts a row for an item that has none", async () => {
    const { test, id, runtime } = await runtimeFor();

    expect(await runtime.bump("synthetic", "attempts")).toBe(1);
    expect(await runtime.bump("synthetic", "attempts")).toBe(2);

    expect(await runtime.countersOf("synthetic")).toEqual({ attempts: 2 });
    expect(
      (await test.store.getItemState(test.scope, id, "synthetic"))?.counters,
    ).toEqual({
      attempts: 2,
    });
  });

  it("refuses to count on an item another run holds, loudly", async () => {
    const { test, id, runtime } = await runtimeFor();
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["x"],
      leasedBy: "other",
      now: test.clock.now().toISOString(),
    });

    await expect(runtime.bump("x", "attempts")).rejects.toBeInstanceOf(
      WorkflowStoreError,
    );
  });

  it("gives every lease back", async () => {
    const { test, id, runtime } = await runtimeFor();
    await runtime.lease([flow("a"), flow("b")]);

    await runtime.releaseAll();

    for (const item of ["a", "b"]) {
      expect(
        (await test.store.getItemState(test.scope, id, item))?.leasedBy,
      ).toBeUndefined();
    }
  });

  it("writes its events in batches the store accepts, with the run's mode and clock", async () => {
    const { test, id, runtime } = await runtimeFor();
    for (let index = 0; index < 501; index += 1) {
      runtime.record({
        itemId: "a",
        kind: "output",
        summary: `event ${index}`,
      });
    }

    await runtime.flushEvents();

    const events = await test.store.listItemEvents(test.scope, {
      workflowId: id,
      itemId: "a",
      limit: 500,
    });
    expect(events.items).toHaveLength(500);
    expect(events.hasMore).toBe(true);
    expect(events.items[0]).toMatchObject({ mode: "live", runId: "run-1" });
  });

  it("bounds an event summary to 2 KB and says it cut it", async () => {
    const { test, id, runtime } = await runtimeFor();
    runtime.record({ itemId: "a", kind: "output", summary: "x".repeat(5000) });
    await runtime.flushEvents();

    const [event] = (
      await test.store.listItemEvents(test.scope, {
        workflowId: id,
        itemId: "a",
      })
    ).items;

    expect(new TextEncoder().encode(event.summary).length).toBeLessThanOrEqual(
      2048,
    );
    expect(event.summary.endsWith("[cut]")).toBe(true);
  });

  it("ends a synthetic item through the inbox items it stands for", async () => {
    const { test, runtime } = await runtimeFor();

    const result = await runtime.end(
      flow("group", { inbox: false, members: ["r1", "r2"] }),
      {
        nodeId: "done",
        outcome: "done",
        status: "resolved",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(test.statuses.written.map((entry) => entry.itemId)).toEqual([
      "r1",
      "r2",
    ]);
    expect(runtime.ended.done).toBe(1);
  });

  it("returns the failure, and records no ended event, when the inbox refuses", async () => {
    const { test, id, runtime } = await runtimeFor();
    test.statuses.refuseNext("down");

    const result = await runtime.end(flow("a"), {
      nodeId: "done",
      outcome: "done",
      status: "resolved",
    });
    await runtime.flushEvents();

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "provider_error" },
    });
    expect(
      (
        await test.store.listItemEvents(test.scope, {
          workflowId: id,
          itemId: "a",
        })
      ).items,
    ).toEqual([]);
    expect(runtime.ended.done).toBe(0);
  });
});

describe("ItemRuntime in a dry run", () => {
  it("takes nothing, counts in memory only, and writes no status", async () => {
    const { test, id, runtime } = await runtimeFor("dry");

    const { won } = await runtime.lease([flow("a")]);
    expect(await runtime.bump("a", "attempts")).toBe(1);
    await runtime.end(flow("a"), {
      nodeId: "done",
      outcome: "done",
      status: "resolved",
    });
    await runtime.releaseAll();

    expect(won.map((item) => item.id)).toEqual(["a"]);
    expect(test.statuses.written).toEqual([]);
    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
  });

  it("reads counters the live runs left, and adds to them in memory", async () => {
    const { test, id, runtime } = await runtimeFor("dry");
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
      counter: "nudges",
      by: 2,
    });

    expect(await runtime.bump("a", "nudges")).toBe(3);

    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({ nudges: 2 });
  });
});

describe("ItemRuntime and parking", () => {
  const wake = {
    wait: "time" as const,
    dueAt: "2026-10-19T13:00:00.000Z",
  };

  async function parkedRuntime() {
    const made = await runtimeFor();
    const { test, id, runtime } = made;
    const [first] = await runtime
      .lease([flow("a")])
      .then((leased) => leased.won);
    await runtime.park(first, {
      nodeId: "done",
      wake,
      context: { data: { title: "a" }, nodes: {}, inbox: true, waitSince: "x" },
    });
    await runtime.releaseAll();
    return {
      ...made,
      state: await test.store.getItemState(test.scope, id, "a"),
    };
  }

  it("parks a leased item, writing its counters with it and ending its lease", async () => {
    const { test, id, runtime } = await runtimeFor();
    await runtime.lease([flow("a")]);
    await runtime.bump("a", "attempts");

    await runtime.park(flow("a"), {
      nodeId: "done",
      wake,
      context: { data: {}, nodes: {} },
    });

    const state = await test.store.getItemState(test.scope, id, "a");
    expect(state).toMatchObject({
      parkedAtNode: "done",
      wake,
      counters: { attempts: 1 },
    });
    expect(state?.leasedBy).toBeUndefined();
  });

  it("gives an item no row yet a row to park on", async () => {
    const { test, id, runtime } = await runtimeFor();

    await runtime.park(flow("synthetic", { inbox: false }), {
      nodeId: "done",
      wake,
      context: {},
    });

    expect(
      (await test.store.getItemState(test.scope, id, "synthetic"))
        ?.parkedAtNode,
    ).toBe("done");
  });

  it("writes nothing when it parks in a dry run", async () => {
    const { test, id, runtime } = await runtimeFor("dry");

    await runtime.park(flow("a"), { nodeId: "done", wake, context: {} });

    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
  });

  it("takes parked items for the resume pass and tells the ones that stopped being parked", async () => {
    const { test, id, runtime, state } = await parkedRuntime();
    expect(state?.parkedAtNode).toBe("done");

    const won = await runtime.leaseParked([state!]);

    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ itemId: "a", parkedAtNode: "done" });
    // Another tick finished it between the list and the lease.
    await test.store.clearParking(test.scope, {
      workflowId: id,
      itemId: "a",
      leasedBy: "lease-1",
    });
    const gone = await runtime.leaseParked([state!]);
    expect(gone[0].parkedAtNode).toBeUndefined();
  });

  it("clears the parking of an item it ends, and keeps its counters", async () => {
    const { test, id, runtime, state } = await parkedRuntime();
    await runtime.leaseParked([state!]);
    await runtime.bump("a", "nudges");

    await runtime.end(flow("a"), {
      nodeId: "done",
      outcome: "done",
      status: "resolved",
    });

    const after = await test.store.getItemState(test.scope, id, "a");
    expect(after?.parkedAtNode).toBeUndefined();
    expect(after?.context).toEqual({});
    expect(after?.counters).toEqual({ nudges: 1 });
    expect(after?.leasedBy).toBeUndefined();
  });

  it("clears the parking of every member of a list it ends", async () => {
    const { test, id, runtime, state } = await parkedRuntime();
    await runtime.leaseParked([state!]);

    await runtime.end(flow("list-1", { inbox: false, members: ["a"] }), {
      nodeId: "done",
      outcome: "done",
      status: "resolved",
    });

    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBeUndefined();
  });

  it("leaves an item parked when the status write that would end it fails", async () => {
    const { test, id, runtime, state } = await parkedRuntime();
    await runtime.leaseParked([state!]);
    test.statuses.refuseNext();

    const ended = await runtime.end(flow("a"), {
      nodeId: "done",
      outcome: "done",
      status: "resolved",
    });

    expect(ended.ok).toBe(false);
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBe("done");
  });
});

describe("ItemRuntime and loop counters", () => {
  it("holds a pass in memory until the item parks, so a pass that never finishes leaves the stored counters alone", async () => {
    const { test, id, runtime } = await runtimeFor();
    await runtime.lease([flow("a")]);

    expect(await runtime.sendBack("a", "e1")).toBe(1);

    expect(await runtime.countersOf("a")).toEqual({ "loop:e1": 1, rounds: 1 });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({});
  });

  it("writes the pending pass in the same statement as the park", async () => {
    const { test, id, runtime } = await runtimeFor();
    await runtime.lease([flow("a")]);
    await runtime.sendBack("a", "e1");
    await runtime.sendBack("a", "e1");

    await runtime.park(flow("a"), {
      nodeId: "done",
      wake: { wait: "time", dueAt: "2026-10-19T13:00:00.000Z" },
      context: {},
    });

    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({ "loop:e1": 2, rounds: 2 });
  });

  it("folds a pending round into the write that releases the item, so the next visit's keys are new", async () => {
    const { test, id, runtime } = await runtimeFor();
    await runtime.lease([flow("a")]);
    await runtime.sendBack("a", "e1");

    await runtime.end(flow("a"), {
      nodeId: "done",
      outcome: "released",
      status: null,
    });

    // Released after one pass: the round counts both the pass and the release.
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters.rounds,
    ).toBe(2);
    expect(await runtime.countersOf("a")).toMatchObject({ rounds: 2 });
  });
});
