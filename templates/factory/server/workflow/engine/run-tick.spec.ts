import { describe, expect, it } from "vitest";

import { SCHEDULE_STARTER } from "../contract.js";
import { STORY_GRAPHS, buildGraph } from "../story-graphs.fixture.js";
import {
  TEST_STARTER,
  chain,
  endWith,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  startedByHand,
  stepOf,
  tick,
  tickAt,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { aiPerItem, failure, ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const lookup = (name = "read") =>
  [
    name,
    "lookup",
    {
      operation: "test.read",
      args: { key: { mode: "path", path: "item.title" } },
    },
  ] as const;

const post = (text = "hi") =>
  [
    "post",
    "action",
    {
      operation: "test.write",
      args: { text: { mode: "fixed", value: text } },
    },
  ] as const;

/** The run totals that only a Wait or a loop moves. */
const NO_WAITING = {
  parked: 0,
  woke: 0,
  stillWaiting: 0,
  sentBack: 0,
  loopLimited: 0,
  graphChanged: 0,
  retryParked: 0,
  retried: 0,
  setAside: 0,
  continued: 0,
  heldBack: 0,
};

const offered = (...ids: string[]) =>
  sourceResult(ids.map((id) => normalizedItem(id)));

describe("loading the workflow", () => {
  it("does not run, and writes nothing, for a workflow that is not there", async () => {
    const test = makeHost();

    const result = await tick(test, "nope");

    expect(result).toMatchObject({
      kind: "not_runnable",
      reason: "workflow_not_found",
    });
  });

  it("refuses a live tick of a workflow that is not enabled, but runs it dry", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]), { enabled: false });
    test.operations.always("test.items", offered("a"));

    const live = await tick(test, id);
    const dry = await tick(test, id, { mode: "dry" });

    expect(live).toMatchObject({
      kind: "not_runnable",
      reason: "workflow_disabled",
    });
    expect(dry.kind).toBe("ran");
    expect(
      (await test.store.listRuns(test.scope, { workflowId: id })).items,
    ).toHaveLength(1);
  });

  it("runs a live tick on the current version only", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));

    const result = await tick(test, id, { graphVersion: 5 });

    expect(result).toMatchObject({
      kind: "not_runnable",
      reason: "version_not_current",
    });
  });

  it("runs a dry or test run on the version asked for, not the current one", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    await test.store.saveWorkflowGraph(test.scope, {
      workflowId: id,
      expectedVersion: 1,
      graph: chain([[...lookup()]]),
      source: "save",
      summary: "adds a lookup",
      createdBy: "owner@example.test",
    });
    test.operations.always("test.items", offered("a"));
    test.operations.always("test.read", ok({ n: 1 }));

    const first = await ran(test, id, { mode: "dry", graphVersion: 1 });
    const current = await ran(test, id, { mode: "dry" });

    expect(first.run.graphVersion).toBe(1);
    expect(first.steps.map((step) => step.nodeId)).toEqual([
      "start",
      "src",
      "done",
    ]);
    expect(current.run.graphVersion).toBe(2);
    expect(current.steps.map((step) => step.nodeId)).toEqual([
      "start",
      "src",
      "read",
      "done",
    ]);
    expect(
      await tick(test, id, { mode: "dry", graphVersion: 9 }),
    ).toMatchObject({
      kind: "not_runnable",
      reason: "version_not_found",
    });
  });

  it("needs the node named for a test run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));

    expect(await tick(test, id, { mode: "test" })).toMatchObject({
      kind: "not_runnable",
      reason: "test_node_required",
    });
  });
});

describe("a tick delivered twice", () => {
  it("does nothing the second time: no source read, no event, no second run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...post()]]));
    test.operations.always("test.items", offered("a"));
    test.operations.always("test.write", ok(null, { externalRef: "r" }));
    const first = await ran(test, id, { tickKey: "2026-10-19T12:00:00Z" });
    const callsBefore = test.operations.calls.length;
    const eventsBefore = (await eventsOf(test, id, "a")).length;

    const second = await tick(test, id, { tickKey: "2026-10-19T12:00:00Z" });

    expect(second).toEqual({ kind: "duplicate_tick", run: first.run });
    expect(test.operations.calls).toHaveLength(callsBefore);
    expect(await eventsOf(test, id, "a")).toHaveLength(eventsBefore);
    expect(test.inbox.requests).toHaveLength(0);
    expect(
      (await test.store.listRuns(test.scope, { workflowId: id })).items,
    ).toHaveLength(1);
  });

  it("returns the earlier run even when it never finished", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    const { run } = await test.store.startRun(test.scope, {
      workflowId: id,
      tickKey: "crashed",
      mode: "live",
      ...startedByHand(),
      graphVersion: 1,
    });

    const result = await tick(test, id, { tickKey: "crashed" });

    expect(result).toEqual({ kind: "duplicate_tick", run });
    expect(test.operations.calls).toHaveLength(0);
  });

  it("runs a different tick key as a new run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", offered());

    await ran(test, id);
    await ran(test, id);

    expect(
      (await test.store.listRuns(test.scope, { workflowId: id })).items,
    ).toHaveLength(2);
  });
});

describe("a graph the engine checks before it runs", () => {
  it("fails the run, with the issues, and runs nothing, when the graph no longer validates", async () => {
    // Saved against the real catalog, run against a host that does not know slack.
    const test = makeHost();
    const { id } = await seedWorkflow(test, STORY_GRAPHS["morning-digest"]);

    const result = await ran(test, id);

    expect(result.run).toMatchObject({
      status: "failed",
      error: {
        code: "graph_invalid",
        message: expect.stringContaining(
          "unknown_operation at commits (github.listCommits)",
        ),
      },
    });
    expect(result.steps).toEqual([]);
    expect(test.operations.calls).toHaveLength(0);
    expect(result.clean).toBe(false);
  });

  it("fails a test of a node that is not in the version", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));

    const result = await ran(test, id, { mode: "test", testNodeId: "ghost" });

    expect(result.run.error).toMatchObject({ code: "graph_invalid" });
  });
});

describe("the window a run covers", () => {
  const digest = () =>
    buildGraph({
      nodes: [
        [
          "weekdays",
          "trigger",
          {
            schedule: { weekdays: { at: "08:00" } },
            timezone: "America/New_York",
          },
        ],
        [
          "commits",
          "source",
          {
            source: "window",
            operation: "test.window",
            args: {},
            maxItems: 100,
          },
        ],
        [
          "post",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value: "{{ run.windowStart }} to {{ run.windowEnd }}",
              },
            },
          },
        ],
        ["done", "end", endWith("done")],
      ],
      edges: [
        ["weekdays", "out", "commits"],
        ["commits", "out", "post"],
        ["post", "out", "done"],
      ],
    });

  async function digestHost() {
    const test = makeHost();
    const { id } = await seedWorkflow(test, digest());
    test.operations.always("test.window", offered("c1"));
    test.operations.always("test.write", ok(null, { externalRef: "r" }));
    return { test, id };
  }

  it("covers Friday morning to Monday morning on a Monday's first run", async () => {
    const { test, id } = await digestHost();

    const result = await ran(test, id, {
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });

    expect(stepOf(result, "weekdays").fields).toMatchObject({
      windowStart: "2026-10-16T12:00:00.000Z",
      windowEnd: "2026-10-19T12:00:00.000Z",
      firstRun: true,
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });
    expect(test.operations.callsTo("test.window")[0].fields).toMatchObject({
      since: "2026-10-16T12:00:00.000Z",
      until: "2026-10-19T12:00:00.000Z",
    });
    expect(test.operations.callsTo("test.write")[0].fields.text).toBe(
      "2026-10-16T12:00:00.000Z to 2026-10-19T12:00:00.000Z",
    );
  });

  it("starts the next window where the last completed run ended, even after downtime", async () => {
    const { test, id } = await digestHost();
    await ran(test, id, { scheduledFor: "2026-10-19T12:00:00.000Z" });

    const afterDowntime = await ran(test, id, {
      scheduledFor: "2026-10-23T12:00:00.000Z",
    });

    expect(stepOf(afterDowntime, "weekdays").fields).toMatchObject({
      windowStart: "2026-10-19T12:00:00.000Z",
      windowEnd: "2026-10-23T12:00:00.000Z",
      firstRun: false,
    });
    expect((await test.store.getWorkflow(test.scope, id))?.lastTriggerAt).toBe(
      "2026-10-23T12:00:00.000Z",
    );
  });

  it("does not read a lookback from the free-form extras any more", async () => {
    const test = makeHost();
    const graph = chain([], { settings: { extras: { lookbackMinutes: 90 } } });
    const { id } = await seedWorkflow(test, graph);
    test.operations.always("test.items", offered());

    const result = await ran(test, id);

    expect(stepOf(result, "start").fields).toMatchObject({
      windowStart: "2026-10-19T11:55:00.000Z",
    });
  });

  it("uses the workflow's own lookback on a first run when it sets one", async () => {
    const test = makeHost();
    const graph = chain([], { settings: { lookbackMinutes: 90 } });
    const { id } = await seedWorkflow(test, graph);
    test.operations.always("test.items", offered());

    const result = await ran(test, id);

    expect(stepOf(result, "start").fields).toMatchObject({
      windowStart: "2026-10-19T10:30:00.000Z",
      windowEnd: "2026-10-19T12:00:00.000Z",
    });
  });

  it("is nothing due, not an error, when a manual run landed after this tick's instant and before the sweep fired it", async () => {
    const { test, id } = await digestHost();
    test.clock.set("2026-10-19T12:00:30.000Z");
    const manual = await ran(test, id);
    expect(manual.run.status).toBe("succeeded");
    test.clock.set("2026-10-19T12:01:00.000Z");

    const result = await tick(test, id, {
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "nothing_due",
      message: expect.stringContaining("already covered"),
    });
    expect((await test.store.getWorkflow(test.scope, id))?.lastTriggerAt).toBe(
      "2026-10-19T12:00:30.000Z",
    );
    expect(
      (await test.store.listRuns(test.scope, { workflowId: id })).items,
    ).toHaveLength(1);
  });

  it("still picks parked items up on that tick, with an empty window instead of an error", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph({ wait: "time", duration: { amount: 20, unit: "minutes" } }),
    );
    test.operations.script("test.items", offered("a"));
    test.operations.always("test.items", offered());
    await tickAt(test, id, "2026-10-19T12:00:00.000Z");
    // A manual run at 12:16 covers the 12:15 tick before the sweep fires it.
    test.clock.set("2026-10-19T12:16:00.000Z");
    await ran(test, id);
    test.clock.set("2026-10-19T12:21:00.000Z");

    const result = await tick(test, id, {
      scheduledFor: "2026-10-19T12:15:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "ran",
      run: { status: "succeeded", counts: { woke: 1, done: 1 } },
      passes: { trigger: false, resumed: 1 },
    });
    expect(test.statuses.statusOf("a")).toBe("resolved");
  });

  it("fails the run, rather than guessing a window, when the last trigger is after this tick's end", async () => {
    const { test, id } = await digestHost();
    await test.store.recordTriggerRun(test.scope, {
      workflowId: id,
      at: "2026-10-20T12:00:00.000Z",
    });

    const result = await ran(test, id, {
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });

    expect(result.run).toMatchObject({
      status: "failed",
      error: {
        code: "engine_error",
        message: expect.stringContaining("last trigger time"),
      },
    });
    expect(result.steps).toEqual([]);
    expect(test.operations.calls).toHaveLength(0);
  });

  it("fails the run for a scheduled instant that is not a date-time", async () => {
    const { test, id } = await digestHost();

    const result = await ran(test, id, { scheduledFor: "monday morning" });

    expect(result.run.error).toMatchObject({ code: "engine_error" });
  });

  it("does not move the window for a dry run, a failed run, or a paused one", async () => {
    const { test, id } = await digestHost();
    const lastTrigger = async () =>
      (await test.store.getWorkflow(test.scope, id))?.lastTriggerAt;

    await ran(test, id, {
      mode: "dry",
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });
    expect(await lastTrigger()).toBeNull();

    test.operations.script("test.window", failure("provider_error"));
    const failed = await ran(test, id, {
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });
    expect(failed.run.status).toBe("failed");
    expect(await lastTrigger()).toBeNull();

    test.stopWhen(() => true);
    const paused = await ran(test, id, {
      scheduledFor: "2026-10-19T12:00:00.000Z",
    });
    expect(paused.run.status).toBe("paused");
    expect(await lastTrigger()).toBeNull();
  });
});

describe("a dry run", () => {
  async function dryHost() {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...lookup()], [...post("Hello {{ item.title }}")]]),
    );
    test.operations.always(
      "test.items",
      sourceResult([normalizedItem("a")], { cursor: "c1" }),
    );
    test.operations.always("test.read", ok({ n: 1 }));
    return { test, id };
  }

  it("reads for real, calls no write, writes no receipt, takes no lease, and changes no item", async () => {
    const { test, id } = await dryHost();

    const result = await ran(test, id, { mode: "dry" });

    expect(test.operations.callsTo("test.items")).toHaveLength(1);
    expect(test.operations.callsTo("test.read")).toHaveLength(1);
    expect(test.operations.callsTo("test.write")).toHaveLength(0);
    expect(test.statuses.written).toEqual([]);
    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
    expect(
      await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "src",
      }),
    ).toBeNull();
    expect(result.run).toMatchObject({ mode: "dry", status: "succeeded" });
    expect(result.clean).toBe(true);
    const events = await eventsOf(test, id, "a");
    expect(events.length).toBeGreaterThan(3);
    expect(events.every((event) => event.mode === "dry")).toBe(true);
    expect(stepOf(result, "post").fields).toMatchObject({ wouldCallCount: 1 });
  });

  it("is not clean when any step failed, so it cannot be the run that enables a workflow", async () => {
    const { test, id } = await dryHost();
    test.operations.script("test.read", failure("credential_missing"));

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.status).toBe("succeeded");
    expect(result.clean).toBe(false);
  });

  it("counts the model calls it made", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [
          "assess",
          "ai",
          {
            instruction: "Assess.",
            mode: "perItem",
            result: { ok: { type: "boolean" } },
          },
        ],
      ]),
    );
    test.operations.always("test.items", offered("a"));
    test.ai.respond(aiPerItem(() => ({ ok: true })));

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.counts.modelCalls).toBe(1);
  });
});

describe("a test of one node", () => {
  it("runs only that node on the samples, with their upstream results, and records it as a test", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [...lookup()],
        [...post("{{ nodes.read.name }} / {{ item.title }}")],
      ]),
    );
    test.operations.always("test.write", ok(null, { externalRef: "r" }));

    const result = await ran(test, id, {
      mode: "test",
      testNodeId: "post",
      sampleItems: [
        {
          id: "s1",
          item: { title: "Pinned" },
          nodes: { read: { name: "Ada" } },
        },
      ],
    });

    expect(result.run.mode).toBe("test");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["post"]);
    expect(test.operations.calls).toHaveLength(0);
    expect(stepOf(result, "post").fields).toMatchObject({
      wouldCall: [
        { item: "s1", fields: expect.stringContaining("Ada / Pinned") },
      ],
    });
    expect(await eventsOf(test, id, "s1")).toEqual([
      expect.objectContaining({ mode: "test", nodeId: "post", kind: "effect" }),
    ]);
  });

  it("runs a source for real with no samples, and leaves its cursor alone", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("a")], { cursor: "c1" }),
    );

    const result = await ran(test, id, { mode: "test", testNodeId: "src" });

    expect(stepOf(result, "src").ports.out.itemIds).toEqual(["a"]);
    expect(result.steps).toHaveLength(1);
    expect(
      await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "src",
      }),
    ).toBeNull();
  });
});

describe("a run that stops early", () => {
  it("is paused, never succeeded, when the soft deadline passes between nodes", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...lookup()], [...post()]]),
    );
    test.operations.script("test.items", async () => {
      test.stopWhen(() => true);
      return offered("a");
    });

    const result = await ran(test, id);

    expect(result.run).toMatchObject({
      status: "paused",
      error: {
        code: "budget_paused",
        message: expect.stringContaining("soft deadline"),
      },
    });
    expect(result.steps.map((step) => [step.nodeId, step.status])).toEqual([
      ["start", "succeeded"],
      ["src", "succeeded"],
      ["read", "skipped"],
      ["post", "skipped"],
      ["done", "skipped"],
    ]);
    expect(stepOf(result, "read")).toMatchObject({
      fields: { reason: "the run paused" },
      error: { code: "budget_paused" },
    });
    expect(result.clean).toBe(false);
    expect(test.operations.callsTo("test.read")).toHaveLength(0);
    expect(test.statuses.written).toEqual([]);
    // What the source took waits at the node that did not run, for the next tick.
    expect(await test.store.getItemState(test.scope, id, "a")).toMatchObject({
      parkedAtNode: "read",
      wake: { wait: "retry" },
    });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.leasedBy,
    ).toBeUndefined();
  });

  it("stops taking more items between the items of a node, and says how many it left", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...lookup()], [...post()]]),
    );
    test.operations.script("test.items", offered("a", "b", "c"));
    test.operations.always("test.read", async () => {
      test.stopWhen(() => true);
      return ok({ n: 1 });
    });

    const result = await ran(test, id);

    expect(test.operations.callsTo("test.read")).toHaveLength(1);
    expect(stepOf(result, "read")).toMatchObject({
      status: "failed",
      error: { code: "budget_paused" },
      fields: { deferred: 2 },
    });
    expect(result.run.status).toBe("paused");
    expect(test.operations.callsTo("test.write")).toHaveLength(0);
    // The one it read waits for the node after it; the two it did not reach wait for the read.
    const where = async (itemId: string) =>
      (await test.store.getItemState(test.scope, id, itemId))?.parkedAtNode;
    expect([await where("a"), await where("b"), await where("c")]).toEqual([
      "post",
      "read",
      "read",
    ]);
  });

  it("is paused when the hard deadline aborts the run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    const controller = new AbortController();
    controller.abort();

    const result = await ran(test, id, { signal: controller.signal });

    expect(result.run).toMatchObject({
      status: "paused",
      error: {
        code: "budget_paused",
        message: expect.stringContaining("hard deadline"),
      },
    });
  });

  it("finishes the next tick, with no effect repeated", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...post()]]));
    test.operations.always("test.items", offered("a", "b"));
    let stopAfterFirstWrite = true;
    test.operations.always("test.write", async () => {
      if (stopAfterFirstWrite) test.stopWhen(() => true);
      return ok(null, { externalRef: "r" });
    });

    const first = await ran(test, id);
    expect(first.run.status).toBe("paused");
    expect(test.operations.callsTo("test.write")).toHaveLength(1);

    stopAfterFirstWrite = false;
    test.stopWhen(() => false);
    const second = await ran(test, id);

    expect(second.run.status).toBe("succeeded");
    // "a" was written once, in the first tick; the second wrote only "b".
    expect(test.operations.callsTo("test.write")).toHaveLength(2);
    expect(test.statuses.written.map((entry) => entry.itemId).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("an unexpected error", () => {
  it("finishes the run failed with engine_error, gives the leases back, and throws", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...lookup()]]));
    test.operations.script("test.items", offered("a"));
    test.operations.script("test.read", () => {
      throw new Error("the provider client crashed");
    });

    await expect(ran(test, id)).rejects.toThrow("the provider client crashed");

    const [run] = (await test.store.listRuns(test.scope, { workflowId: id }))
      .items;
    expect(run).toMatchObject({
      status: "failed",
      error: {
        code: "engine_error",
        message: expect.stringContaining("the provider client crashed"),
      },
    });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.leasedBy,
    ).toBeUndefined();
    // The events up to the crash are kept.
    expect((await eventsOf(test, id, "a")).map((event) => event.kind)).toEqual([
      "taken",
    ]);
  });

  it("surfaces a store failure too, tagging the code, and still tries to mark the run failed", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.script("test.items", offered("a"));
    const putStep = test.store.putStep.bind(test.store);
    let calls = 0;
    test.store.putStep = async (scope, step) => {
      calls += 1;
      if (calls === 2) {
        const { WorkflowStoreError } = await import("../adapter.js");
        throw new WorkflowStoreError(
          "corrupt_record",
          "the step row is corrupt",
        );
      }
      return putStep(scope, step);
    };

    await expect(ran(test, id)).rejects.toMatchObject({
      code: "corrupt_record",
    });

    const [run] = (await test.store.listRuns(test.scope, { workflowId: id }))
      .items;
    expect(run.error).toMatchObject({
      code: "engine_error",
      message: expect.stringContaining("corrupt_record"),
    });
  });
});

describe("what started a run", () => {
  it("is recorded on the run, with who started it, for each way a run starts", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", offered());

    const scheduled = await tickAt(test, id, "2026-10-19T12:00:00.000Z");
    const manual = await ran(test, id);
    const dry = await ran(test, id, { mode: "dry" });
    const tested = await ran(test, id, { mode: "test", testNodeId: "done" });

    expect(scheduled.kind === "ran" && scheduled.run).toMatchObject({
      triggerKind: "schedule",
      startedBy: SCHEDULE_STARTER,
    });
    expect([manual, dry, tested].map((result) => result.run)).toMatchObject([
      { mode: "live", triggerKind: "manual", startedBy: TEST_STARTER },
      { mode: "dry", triggerKind: "dry_run", startedBy: TEST_STARTER },
      { mode: "test", triggerKind: "test", startedBy: TEST_STARTER },
    ]);
    // What the store holds is what the run says; nothing is worked out from the tick key.
    const stored = await test.store.listRuns(test.scope, { workflowId: id });
    expect(
      stored.items.map((run) => [
        run.tickKey.startsWith("tick-"),
        run.triggerKind,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [true, "manual"],
        [true, "dry_run"],
        [true, "test"],
        [false, "schedule"],
      ]),
    );
  });

  it("runs the new-items pass for a manual run whatever its scheduled instant, and checks the Trigger only for a scheduled one", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", offered("a"));
    await tickAt(test, id, "2026-10-19T12:00:00.000Z");

    // The Trigger already fired for 12:00, so a second scheduled tick has nothing to do.
    const again = await tickAt(test, id, "2026-10-19T12:01:00.000Z", {
      tickKey: "2026-10-19T12:01:00.000Z",
    });
    const byHand = await ran(test, id, {
      scheduledFor: "2026-10-19T12:01:00.000Z",
      triggerKind: "manual",
      startedBy: TEST_STARTER,
    });

    expect(again.kind).toBe("nothing_due");
    expect(byHand.passes.trigger).toBe(true);
  });

  it("refuses a scheduled run that does not name the instant it was scheduled for", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));

    const result = await tick(test, id, {
      triggerKind: "schedule",
      startedBy: SCHEDULE_STARTER,
    });

    expect(result).toMatchObject({
      kind: "not_runnable",
      reason: "scheduled_for_required",
    });
    expect(
      (await test.store.listRuns(test.scope, { workflowId: id })).items,
    ).toEqual([]);
  });

  it.each([
    [
      "a dry run started by the schedule",
      { mode: "dry", triggerKind: "schedule", startedBy: SCHEDULE_STARTER },
    ],
    [
      "a manual run credited to the schedule",
      { mode: "live", triggerKind: "manual", startedBy: SCHEDULE_STARTER },
    ],
    [
      "a live run that claims to be a dry run",
      { mode: "live", triggerKind: "dry_run", startedBy: TEST_STARTER },
    ],
  ] as const)(
    "throws before it starts anything for %s, instead of recording a run that contradicts itself",
    async (_name, input) => {
      const test = makeHost();
      const { id } = await seedWorkflow(test, chain([]));
      test.operations.always("test.items", offered("a"));

      await expect(
        tick(test, id, { ...input, scheduledFor: "2026-10-19T12:00:00.000Z" }),
      ).rejects.toMatchObject({ code: "invalid_record" });

      expect(test.operations.calls).toEqual([]);
      expect(
        (await test.store.listRuns(test.scope, { workflowId: id })).items,
      ).toEqual([]);
    },
  );
});

describe("the run as recorded", () => {
  it("is what the store holds, in graph order, with totals", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...lookup()]]));
    test.operations.script("test.items", offered("a", "b"));
    test.operations.always("test.read", ok({ n: 1 }));

    const result = await ran(test, id);

    const stored = await test.store.getRun(test.scope, result.run.id);
    expect(stored?.run).toEqual(result.run);
    expect(stored?.steps.map((step) => step.nodeId).sort()).toEqual(
      result.steps.map((step) => step.nodeId).sort(),
    );
    expect(result.steps.map((step) => step.nodeId)).toEqual([
      "start",
      "src",
      "read",
      "done",
    ]);
    expect(result.run.counts).toEqual({
      taken: 2,
      done: 2,
      dismissed: 0,
      needsManual: 0,
      released: 0,
      itemFailures: 0,
      needsCheck: 0,
      skippedRows: 0,
      modelCalls: 0,
      ...NO_WAITING,
    });
    expect(result.clean).toBe(true);
  });

  it("records a tick with nothing to do as a run with every node at zero", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...lookup()]]));
    test.operations.script("test.items", offered());

    const result = await ran(test, id);

    expect(result.run.status).toBe("succeeded");
    expect(result.steps.map((step) => [step.nodeId, step.fields?.in])).toEqual([
      ["start", 0],
      ["src", 0],
      ["read", 0],
      ["done", 0],
    ]);
  });

  it("takes an item a tick left for next time again, under a new lease owner", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...lookup()]], { end: endWith("released") }),
    );
    test.operations.always("test.items", offered("a"));
    test.operations.always("test.read", ok({ n: 1 }));

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(first.run.counts).toMatchObject({ taken: 1, released: 1 });
    expect(second.run.counts).toMatchObject({ taken: 1, released: 1 });
    expect(test.statuses.written).toEqual([]);
  });
});
