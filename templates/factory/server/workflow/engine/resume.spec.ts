import { describe, expect, it } from "vitest";

import {
  SCHEDULE_STARTER,
  WorkflowError,
  type WorkflowGraph,
} from "../contract.js";
import { buildGraph } from "../story-graphs.fixture.js";
import {
  T0,
  eventsOf,
  minutesAfter,
  normalizedItem,
  ranAt,
  sourceResult,
  stepOf,
  threadOf,
  threadedItem,
  tickAt,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { failure, ok } from "../testing/fakes.js";
import {
  createInMemoryStoreState,
  createInMemoryWorkflowStore,
} from "../testing/in-memory-store.js";
import {
  makeHost,
  reenable,
  seedWorkflow,
  type TestHost,
} from "../testing/make-host.js";
import { runTick } from "./run-tick.js";

const HOUR = 60;

/** The instant a failed read is recorded at: after the five seconds of backoff its own retries took. */
const afterBackoff = (minutes: number): string =>
  new Date(Date.parse(minutesAfter(minutes)) + 5_000).toISOString();

/** Parks the given items at the Wait of `graph` on a tick at T0, and stops the source offering more. */
async function parkedAt(
  graph: WorkflowGraph,
  items = [threadedItem("a")],
  test: TestHost = makeHost(),
) {
  const { id } = await seedWorkflow(test, graph);
  test.operations.script("test.items", sourceResult(items));
  test.operations.always("test.items", sourceResult([]));
  const first = await ranAt(test, id, T0);
  expect(first.run.counts).toMatchObject({ parked: items.length });
  return { test, id };
}

const stateOf = (test: TestHost, id: string, itemId = "a") =>
  test.store.getItemState(test.scope, id, itemId);

describe("a time wait", () => {
  const graph = () =>
    waitGraph({ wait: "time", duration: { amount: 1, unit: "hours" } });

  it("sends the item out of Done once its time has come, ends its parking, and keeps its counters", async () => {
    const { test, id } = await parkedAt(graph());

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.passes).toEqual({ trigger: true, resumed: 1 });
    expect(stepOf(result, "pause")).toMatchObject({
      status: "succeeded",
      ports: { done: { count: 1, itemIds: ["a"] } },
      fields: { in: 0, due: 1, woke: 1, stillWaiting: 0 },
    });
    expect(stepOf(result, "end_done").ports).toEqual({});
    expect(result.run.counts).toMatchObject({ woke: 1, done: 1 });
    expect(test.statuses.statusOf("a")).toBe("resolved");
    const state = await stateOf(test, id);
    expect(state).toMatchObject({ context: {} });
    expect(state?.parkedAtNode).toBeUndefined();
    expect(state?.wake).toBeUndefined();
    expect(state?.leasedBy).toBeUndefined();
    expect((await eventsOf(test, id, "a")).map((event) => event.kind)).toEqual([
      "taken",
      "parked",
      "woke",
      "ended",
    ]);
    expect((await eventsOf(test, id, "a"))[2]).toMatchObject({
      kind: "woke",
      port: "done",
      nodeId: "pause",
    });
  });

  it("does nothing to the item before its time: the Wait runs over what the sources sent it, which is nothing", async () => {
    const { test, id } = await parkedAt(graph());

    const result = await ranAt(test, id, minutesAfter(30));

    expect(result.passes).toEqual({ trigger: true, resumed: 0 });
    expect(stepOf(result, "pause").fields).toEqual({
      wait: "time",
      in: 0,
      parked: 0,
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBe("pause");
    expect(test.statuses.written).toEqual([]);
  });

  it("hands what the Wait learned to the nodes after it", async () => {
    const test = makeHost();
    const withReason = buildGraph({
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
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 1, unit: "hours" } },
        ],
        [
          "finish",
          "end",
          {
            outcome: "dismissed",
            reason:
              "{{ nodes.pause.outcome }} at {{ nodes.pause.waitedUntil }}",
          },
        ],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "pause"],
        ["pause", "done", "finish"],
      ],
    });
    const { id } = await parkedAt(withReason, [normalizedItem("a")], test);

    await ranAt(test, id, minutesAfter(HOUR));

    expect(test.statuses.written[0]).toMatchObject({
      status: "dismissed",
      reason: `done at ${minutesAfter(HOUR)}`,
    });
  });
});

describe("a reply wait", () => {
  const graph = (extra: Record<string, unknown> = {}) =>
    waitGraph({ wait: "reply", limitHours: 24, ...extra });

  it("looks at the thread on its check time, and parks the item again with a later check when nobody has replied", async () => {
    const { test, id } = await parkedAt(graph());
    const before = await stateOf(test, id);

    const result = await ranAt(test, id, minutesAfter(15));

    expect(test.threads.requests).toHaveLength(1);
    expect(test.threads.requests[0]).toMatchObject({
      thread: threadOf("a"),
      since: T0,
      acceptFrom: "anyone",
      ackReaction: "white_check_mark",
      ownerEmail: "owner@example.test",
    });
    expect(stepOf(result, "pause")).toMatchObject({
      status: "succeeded",
      fields: { due: 1, woke: 0, stillWaiting: 1 },
    });
    expect(result.run.counts).toMatchObject({ stillWaiting: 1, woke: 0 });
    const after = await stateOf(test, id);
    // The deadline and what the item carries are the same; only the check moved.
    expect(after?.wake).toEqual({
      ...before?.wake,
      nextCheckAt: minutesAfter(30),
    });
    expect(after?.context).toEqual(before?.context);
    expect(after?.parkedAtNode).toBe("pause");
    expect(after?.leasedBy).toBeUndefined();
  });

  it("wakes out of Replied for a human reply after the wait began, and ignores a bot, an older message, and a person it does not accept", async () => {
    const { test, id } = await parkedAt(
      graph({ acceptFrom: { emails: ["owner@example.test"] } }),
    );
    test.threads.post(
      threadOf("a"),
      { at: minutesAfter(-5), author: "owner@example.test", text: "before" },
      { at: minutesAfter(3), author: "bot@example.test", bot: true },
      { at: minutesAfter(4), author: "stranger@example.test", text: "hi" },
    );
    const quiet = await ranAt(test, id, minutesAfter(15));
    expect(quiet.run.counts).toMatchObject({ woke: 0, stillWaiting: 1 });

    test.threads.post(threadOf("a"), {
      at: minutesAfter(20),
      author: "owner@example.test",
      text: "On it",
    });
    const result = await ranAt(test, id, minutesAfter(30));

    expect(stepOf(result, "pause").ports).toMatchObject({
      replied: { count: 1, itemIds: ["a"] },
      timedOut: { count: 0 },
    });
    expect(test.statuses.statusOf("a")).toBe("resolved");
    const woke = (await eventsOf(test, id, "a")).find(
      (event) => event.kind === "woke",
    );
    expect(woke).toMatchObject({
      port: "replied",
      summary: expect.stringContaining("1 reply"),
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("counts the acknowledgement reaction as an answer, the default one or the one the node names", async () => {
    const { test, id } = await parkedAt(graph({ ackReaction: "eyes" }));
    test.threads.post(threadOf("a"), {
      at: minutesAfter(2),
      author: "x@example.test",
      reaction: "white_check_mark",
    });
    const none = await ranAt(test, id, minutesAfter(15));
    expect(none.run.counts).toMatchObject({ woke: 0 });
    expect(test.threads.requests[0].ackReaction).toBe("eyes");

    test.threads.post(threadOf("a"), {
      at: minutesAfter(20),
      author: "x@example.test",
      reaction: "eyes",
    });
    const result = await ranAt(test, id, minutesAfter(30));

    expect(stepOf(result, "pause").ports).toMatchObject({
      replied: { count: 1 },
    });
  });

  it("sends the item out of Timed out when the deadline passes and nobody replied", async () => {
    const { test, id } = await parkedAt(graph());

    const result = await ranAt(test, id, minutesAfter(24 * HOUR));

    expect(stepOf(result, "pause").ports).toMatchObject({
      timedOut: { count: 1, itemIds: ["a"] },
      replied: { count: 0 },
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("counts a reply it finds on the deadline check as a reply, not a time out", async () => {
    const { test, id } = await parkedAt(graph());
    test.threads.post(threadOf("a"), {
      at: minutesAfter(24 * HOUR - 10),
      author: "x@example.test",
    });

    const result = await ranAt(test, id, minutesAfter(24 * HOUR + 5));

    expect(stepOf(result, "pause").ports).toMatchObject({
      replied: { count: 1 },
      timedOut: { count: 0 },
    });
  });

  it("never times an item out on a read that failed: a read a later look may fix leaves it parked with its deadline and spends no attempt", async () => {
    const { test, id } = await parkedAt(graph());
    // Three failures: the read is tried three times within the tick.
    test.threads.failNext(3, { message: "Slack is down", retryable: true });
    const before = await stateOf(test, id);

    const result = await ranAt(test, id, minutesAfter(24 * HOUR + 5));

    expect(stepOf(result, "pause")).toMatchObject({
      status: "failed",
      error: {
        code: "provider_error",
        message: expect.stringContaining("Slack is down"),
      },
      ports: { timedOut: { count: 0 }, replied: { count: 0 } },
    });
    expect(result.run.counts).toMatchObject({
      itemFailures: 1,
      woke: 0,
      stillWaiting: 1,
      needsManual: 0,
    });
    const after = await stateOf(test, id);
    expect(after?.parkedAtNode).toBe("pause");
    // Its deadline is unchanged; there is no later check before it, so the deadline is the check.
    expect(after?.wake).toEqual({
      wait: "reply",
      dueAt: before?.wake?.dueAt,
      thread: before?.wake?.thread,
      readFailingSince: afterBackoff(24 * HOUR + 5),
    });
    expect(after?.counters).toEqual({});
    expect(test.statuses.written).toEqual([]);
    expect(
      (await eventsOf(test, id, "a")).find((event) => event.kind === "error"),
    ).toMatchObject({ code: "provider_error", nodeId: "pause" });

    // The next look can read, finds nobody, and only then does the item time out.
    const next = await ranAt(test, id, minutesAfter(24 * HOUR + 10));
    expect(stepOf(next, "pause").ports).toMatchObject({
      timedOut: { count: 1 },
    });
  });

  it("hands the item to a person at once when the thread can never be read", async () => {
    const { test, id } = await parkedAt(graph());
    test.threads.failNext(1, {
      code: "credential_missing",
      message: "channel_not_found",
    });

    const result = await ranAt(test, id, minutesAfter(15));

    expect(result.run.counts).toMatchObject({
      itemFailures: 1,
      needsManual: 1,
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect(test.statuses.written[0].reason).toContain("channel_not_found");
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("keeps waiting through an outage shorter than the patience, and the failures do not add up to attempts", async () => {
    const { test, id } = await parkedAt(graph());
    // Four checks a cadence apart, each reading three times before it gives up.
    test.threads.failNext(12, { retryable: true });
    for (const minutes of [15, 31, 47, 63]) {
      await ranAt(test, id, minutesAfter(minutes));
    }
    const state = await stateOf(test, id);
    expect(state?.parkedAtNode).toBe("pause");
    expect(state?.counters).toEqual({});
    expect(state?.wake?.readFailingSince).toBe(afterBackoff(15));
    expect(test.statuses.written).toEqual([]);

    // The read works again: the streak is forgotten with the wake that held it.
    test.threads.post(threadOf("a"), {
      at: minutesAfter(70),
      author: "x@example.test",
    });
    const recovered = await ranAt(test, id, minutesAfter(79));

    expect(stepOf(recovered, "pause").ports).toMatchObject({
      replied: { count: 1 },
    });
    expect(test.statuses.statusOf("a")).toBe("resolved");
  });

  it("forgets a streak of failed reads when one read works, even if nobody has answered yet", async () => {
    const { test, id } = await parkedAt(graph());
    test.threads.failNext(3, { retryable: true });
    await ranAt(test, id, minutesAfter(15));
    expect((await stateOf(test, id))?.wake?.readFailingSince).toBe(
      afterBackoff(15),
    );

    // A read that works and finds nobody: still waiting, and the streak is over.
    await ranAt(test, id, minutesAfter(31));
    expect((await stateOf(test, id))?.wake?.readFailingSince).toBeUndefined();

    // A later outage starts a streak of its own.
    test.threads.failNext(3, { retryable: true });
    await ranAt(test, id, minutesAfter(47));
    expect((await stateOf(test, id))?.wake?.readFailingSince).toBe(
      afterBackoff(47),
    );
  });

  it("hands the item to a person when every look for two hours has failed, with the reason", async () => {
    const { test, id } = await parkedAt(graph());
    test.threads.failNext(100, { retryable: true, message: "Slack is down" });

    await ranAt(test, id, minutesAfter(15));
    await ranAt(test, id, minutesAfter(75));
    expect(test.statuses.written).toEqual([]);
    expect((await stateOf(test, id))?.parkedAtNode).toBe("pause");
    const last = await ranAt(test, id, minutesAfter(136));

    expect(last.run.counts).toMatchObject({ needsManual: 1 });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect(test.statuses.written[0].reason).toContain("Slack is down");
    expect(test.statuses.written[0].reason).toContain(
      `every look since ${afterBackoff(15)} has failed`,
    );
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("retries a read that failed with nothing done before it counts an attempt", async () => {
    const { test, id } = await parkedAt(graph());
    test.threads.failNext(2, { retryable: true });
    test.threads.post(threadOf("a"), {
      at: minutesAfter(5),
      author: "x@example.test",
    });

    const result = await ranAt(test, id, minutesAfter(15));

    expect(test.threads.requests).toHaveLength(3);
    expect(test.clock.sleeps).toEqual([1000, 4000]);
    expect(result.run.counts).toMatchObject({ woke: 1, itemFailures: 0 });
  });
});

describe("a condition wait", () => {
  const graph = (extra: Record<string, unknown> = {}) =>
    waitGraph({
      wait: "condition",
      operation: "test.read",
      args: { key: { mode: "path", path: "item.title" } },
      rule: { left: "item.status", op: "equals", right: "resolved" },
      everyMinutes: 30,
      limitHours: 1,
      ...extra,
    });

  it("reads its operation for the item and tests the rule on what came back, until it is met", async () => {
    const { test, id } = await parkedAt(graph());
    test.operations.script(
      "test.read",
      ok({ status: "open" }),
      ok({ status: "resolved" }),
    );

    const first = await ranAt(test, id, minutesAfter(30));
    expect(test.operations.callsTo("test.read")[0]).toMatchObject({
      fields: { key: "Item a" },
      credentialSlot: "test",
      mode: "live",
    });
    expect(first.run.counts).toMatchObject({ stillWaiting: 1, woke: 0 });
    // The next check would fall on the deadline, so the deadline is the check.
    expect((await stateOf(test, id))?.wake).toEqual({
      wait: "condition",
      dueAt: minutesAfter(60),
    });
    // The deadline is also the check, and a rule that is met at the deadline is met.
    const second = await ranAt(test, id, minutesAfter(60));

    expect(stepOf(second, "pause").ports).toMatchObject({
      met: { count: 1, itemIds: ["a"] },
      timedOut: { count: 0 },
    });
    expect(test.statuses.statusOf("a")).toBe("resolved");
  });

  it("times out at its deadline when the rule was never met", async () => {
    const { test, id } = await parkedAt(graph());
    test.operations.always("test.read", ok({ status: "open" }));

    const result = await ranAt(test, id, minutesAfter(60));

    expect(stepOf(result, "pause").ports).toMatchObject({
      timedOut: { count: 1 },
      met: { count: 0 },
    });
  });

  it("hands the item to a person at once when the result has no field the rule reads", async () => {
    const { test, id } = await parkedAt(graph());
    test.operations.always("test.read", ok({ state: "resolved" }));

    const result = await ranAt(test, id, minutesAfter(30));

    expect(stepOf(result, "pause")).toMatchObject({
      status: "failed",
      error: { code: "expression_failed" },
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("does not read a failed lookup as the condition being false, even at the deadline", async () => {
    const { test, id } = await parkedAt(graph());
    test.operations.always("test.read", failure("provider_error"));

    const result = await ranAt(test, id, minutesAfter(60));

    expect(stepOf(result, "pause")).toMatchObject({
      status: "failed",
      error: { code: "provider_error" },
      ports: { timedOut: { count: 0 }, met: { count: 0 } },
    });
    expect((await stateOf(test, id))?.counters).toEqual({ attempts: 1 });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
  });

  it("keeps a condition that cannot be read for now parked with its deadline, and spends no attempt", async () => {
    const { test, id } = await parkedAt(graph());
    test.operations.always(
      "test.read",
      failure("provider_error", { retryable: true, message: "502" }),
    );

    const result = await ranAt(test, id, minutesAfter(60));

    expect(stepOf(result, "pause")).toMatchObject({
      status: "failed",
      error: { code: "provider_error" },
      ports: { timedOut: { count: 0 }, met: { count: 0 } },
    });
    const state = await stateOf(test, id);
    expect(state?.parkedAtNode).toBe("pause");
    expect(state?.counters).toEqual({});
    expect(state?.wake).toMatchObject({
      wait: "condition",
      readFailingSince: afterBackoff(60),
    });
    expect(test.statuses.written).toEqual([]);
  });

  it("fails an item whose lookup returned nothing at all, which is not the same as not met", async () => {
    const { test, id } = await parkedAt(graph());
    test.operations.always("test.read", { ok: true, output: undefined });

    const result = await ranAt(test, id, minutesAfter(30));

    expect(stepOf(result, "pause").error?.code).toBe("lookup_failed");
  });
});

describe("the resume pass", () => {
  const timeGraph = () =>
    waitGraph(
      { wait: "time", duration: { amount: 1, unit: "hours" } },
      {
        source: {
          source: "provider-query",
          operation: "test.items",
          args: {},
          memory: "inbox",
          maxItems: 50,
        },
      },
    );

  it("looks at no more than 20 parked items a tick, earliest first, and takes the rest next tick", async () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      normalizedItem(`i${String(index).padStart(2, "0")}`),
    );
    const { test, id } = await parkedAt(timeGraph(), items);

    const first = await ranAt(test, id, minutesAfter(HOUR));
    const second = await ranAt(test, id, minutesAfter(HOUR + 5));

    expect(first.passes.resumed).toBe(20);
    expect(first.run.counts).toMatchObject({ woke: 20, done: 20 });
    expect(second.passes.resumed).toBe(5);
    expect(second.run.counts).toMatchObject({ woke: 5, done: 5 });
    expect(test.statuses.written).toHaveLength(25);
  });

  it("leaves an item another live tick holds alone, and takes it once the lease has run out", async () => {
    const { test, id } = await parkedAt(timeGraph(), [normalizedItem("a")]);
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "another-tick",
      now: minutesAfter(HOUR),
    });

    const held = await ranAt(test, id, minutesAfter(HOUR));
    expect(held.passes.resumed).toBe(0);
    expect(held.run.counts).toMatchObject({ woke: 0 });
    expect((await stateOf(test, id))?.leasedBy).toBe("another-tick");

    // The other tick died: its lease is a 15-minute lease, and then it is free.
    const later = await ranAt(test, id, minutesAfter(HOUR + 16));
    expect(later.run.counts).toMatchObject({ woke: 1, done: 1 });
  });

  it("gives every lease back when a tick crashes while it is resuming", async () => {
    const { test, id } = await parkedAt(
      waitGraph({
        wait: "condition",
        operation: "test.read",
        args: { key: { mode: "path", path: "item.title" } },
        rule: { left: "item.status", op: "equals", right: "resolved" },
        everyMinutes: 30,
        limitHours: 1,
      }),
      [normalizedItem("a"), normalizedItem("b")],
    );
    test.operations.script("test.read", () => {
      throw new Error("the process lost its database");
    });

    await expect(ranAt(test, id, minutesAfter(30))).rejects.toThrow(
      "lost its database",
    );

    for (const itemId of ["a", "b"]) {
      const state = await stateOf(test, id, itemId);
      expect(state?.leasedBy).toBeUndefined();
      expect(state?.parkedAtNode).toBe("pause");
    }
    const [run] = (await test.store.listRuns(test.scope, { workflowId: id }))
      .items;
    expect(run).toMatchObject({
      status: "failed",
      error: { code: "engine_error" },
    });
  });

  it("pauses at the soft deadline, leaves what it did not reach parked, and finishes them next tick", async () => {
    const items = ["a", "b", "c"].map((name) => threadedItem(name));
    const { test, id } = await parkedAt(
      waitGraph({ wait: "reply", limitHours: 24 }),
      items,
    );
    test.stopWhen(() => test.threads.requests.length >= 1);

    const paused = await ranAt(test, id, minutesAfter(15));

    expect(paused.run).toMatchObject({
      status: "paused",
      error: { code: "budget_paused" },
    });
    expect(stepOf(paused, "pause")).toMatchObject({
      status: "failed",
      fields: { stillWaiting: 1, deferred: 2 },
    });
    expect(test.threads.requests).toHaveLength(1);
    const untouched = await Promise.all(
      ["a", "b", "c"].map((itemId) => stateOf(test, id, itemId)),
    );
    expect(untouched.every((state) => state?.parkedAtNode === "pause")).toBe(
      true,
    );
    expect(untouched.every((state) => state?.leasedBy === undefined)).toBe(
      true,
    );

    test.stopWhen(() => false);
    // The one it reached was looked at and has a later check; the other two are due.
    const resumed = await ranAt(test, id, minutesAfter(20));
    expect(resumed.passes.resumed).toBe(2);
    expect(resumed.run.counts).toMatchObject({ stillWaiting: 2 });
  });

  it("pauses before it looks at anything when the soft deadline has already passed, and leaves every item parked", async () => {
    const { test, id } = await parkedAt(
      waitGraph({ wait: "reply", limitHours: 24 }),
      [threadedItem("a"), threadedItem("b")],
    );
    test.stopWhen(() => true);

    const result = await ranAt(test, id, minutesAfter(15));

    expect(result.run).toMatchObject({
      status: "paused",
      error: { code: "budget_paused" },
    });
    expect(stepOf(result, "pause").status).toBe("skipped");
    expect(test.threads.requests).toEqual([]);
    for (const itemId of ["a", "b"]) {
      const state = await stateOf(test, id, itemId);
      expect(state?.parkedAtNode).toBe("pause");
      expect(state?.leasedBy).toBeUndefined();
    }
  });

  it("lets a woken item that a run died on at a later node be woken again without sending what it already sent", async () => {
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
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 1, unit: "hours" } },
        ],
        [
          "post",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "fixed", value: "Time is up" } },
          },
        ],
        [
          "read",
          "lookup",
          {
            operation: "test.read",
            args: { key: { mode: "path", path: "item.title" } },
          },
        ],
        ["finish", "end", { outcome: "done" }],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "pause"],
        ["pause", "done", "post"],
        ["post", "out", "read"],
        ["read", "out", "finish"],
      ],
    });
    const { id } = await parkedAt(graph, [normalizedItem("a")], test);
    test.operations.always("test.write", ok(null, { externalRef: "m-1" }));
    test.operations.script(
      "test.read",
      () => {
        throw new Error("the process died after the write");
      },
      ok({ n: 1 }),
    );

    await expect(ranAt(test, id, minutesAfter(HOUR))).rejects.toThrow("died");
    // The run died at a later node: still parked, not ended, nothing set.
    expect((await stateOf(test, id))?.parkedAtNode).toBe("pause");
    expect(test.statuses.written).toEqual([]);

    const second = await ranAt(test, id, minutesAfter(HOUR + 5));

    expect(second.run.counts).toMatchObject({ woke: 1, done: 1 });
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(stepOf(second, "post").fields).toMatchObject({ reused: 1 });
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("never sends twice when a tick died between a write and closing its receipt: the item goes to a person", async () => {
    const test = makeHost();
    const sent: string[] = [];
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
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 1, unit: "hours" } },
        ],
        [
          "post",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "fixed", value: "Time is up" } },
          },
        ],
        ["finish", "end", { outcome: "done" }],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "pause"],
        ["pause", "done", "post"],
        ["post", "out", "finish"],
      ],
    });
    const { id } = await parkedAt(graph, [normalizedItem("a")], test);
    test.operations.script("test.write", () => {
      sent.push("message");
      throw new Error("the process died after the call went out");
    });

    await expect(ranAt(test, id, minutesAfter(HOUR))).rejects.toThrow("died");
    const retry = await ranAt(test, id, minutesAfter(HOUR + 5));

    expect(sent).toEqual(["message"]);
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(stepOf(retry, "post")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("survives a restart: a second process over the same rows wakes what the first parked", async () => {
    const state = createInMemoryStoreState();
    const first = makeHost({ state });
    const { id } = await parkedAt(timeGraph(), [normalizedItem("a")], first);
    const restarted = {
      ...first.host,
      store: createInMemoryWorkflowStore({
        clock: () => first.clock.now(),
        state,
      }),
    };
    first.clock.set(minutesAfter(HOUR));

    const result = await runTick({
      host: restarted,
      scope: first.scope,
      workflowId: id,
      tickKey: "after-restart",
      mode: "live",
      triggerKind: "schedule",
      startedBy: SCHEDULE_STARTER,
      scheduledFor: minutesAfter(HOUR),
    });

    expect(result.kind).toBe("ran");
    expect(first.statuses.statusOf("a")).toBe("resolved");
  });
});

describe("a parked item whose workflow was edited while it waited", () => {
  const edited = (
    pauseSettings: Record<string, unknown>,
    ends?: Record<string, unknown>,
  ): WorkflowGraph =>
    waitGraph(pauseSettings, {
      source: {
        source: "provider-query",
        operation: "test.items",
        args: {},
        memory: "inbox",
        maxItems: 50,
      },
      ...(ends ? { ends } : {}),
    });
  const HOUR_WAIT = { wait: "time", duration: { amount: 1, unit: "hours" } };

  async function parkThenSave(
    next: WorkflowGraph,
    wait: Record<string, unknown> = {
      wait: "time",
      duration: { amount: 1, unit: "hours" },
    },
  ) {
    const { test, id } = await parkedAt(edited(wait), [normalizedItem("a")]);
    await test.store.saveWorkflowGraph(test.scope, {
      workflowId: id,
      expectedVersion: 1,
      graph: next,
      source: "save",
      summary: "edited while an item waited",
      createdBy: "owner@example.test",
    });
    await reenable(test, id);
    return { test, id };
  }

  it("goes to a person, with the reason, when its Wait is gone", async () => {
    const gone = buildGraph({
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
        ["finish", "end", { outcome: "done" }],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "finish"],
      ],
    });
    const { test, id } = await parkThenSave(gone);

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run.counts).toMatchObject({
      needsManual: 1,
      graphChanged: 1,
      woke: 0,
    });
    expect(test.statuses.written).toEqual([
      expect.objectContaining({
        itemId: "a",
        status: "needs_manual",
        reason: expect.stringContaining(
          "The workflow changed while this was waiting",
        ),
      }),
    ]);
    const events = await eventsOf(test, id, "a");
    expect(events.find((event) => event.kind === "error")).toMatchObject({
      nodeId: "pause",
      code: "graph_changed_while_waiting",
      summary: expect.stringContaining("graph_changed_while_waiting"),
    });
    expect(events.find((event) => event.kind === "ended")).toMatchObject({
      outcome: "needsManual",
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("goes to a person, naming the path, when the graph now reads something after the Wait that the item did not keep", async () => {
    const { test, id } = await parkThenSave(
      edited(HOUR_WAIT, { reason: "{{ item.title }} was waiting" }),
    );

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run.counts).toMatchObject({
      needsManual: 1,
      graphChanged: 1,
      woke: 0,
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect(test.statuses.written[0].reason).toContain(
      '"item.title" is read after "pause" now',
    );
    expect(
      (await eventsOf(test, id, "a")).find((event) => event.kind === "error"),
    ).toMatchObject({
      code: "graph_changed_while_waiting",
      summary: expect.stringContaining("item.title"),
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });

  it("carries on when the edit reads only what the item kept", async () => {
    const reading = { reason: "{{ item.title }} was waiting" };
    const { test, id } = await parkedAt(edited(HOUR_WAIT, reading), [
      normalizedItem("a"),
    ]);
    await test.store.saveWorkflowGraph(test.scope, {
      workflowId: id,
      expectedVersion: 1,
      graph: edited(HOUR_WAIT, { ...reading, setStatus: "resolved" }),
      source: "save",
      summary: "reads the same title",
      createdBy: "owner@example.test",
    });
    await reenable(test, id);

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run.counts).toMatchObject({ woke: 1, graphChanged: 0 });
    expect(test.statuses.written).toEqual([
      expect.objectContaining({
        itemId: "a",
        status: "resolved",
        reason: "Item a was waiting",
      }),
    ]);
  });

  it("reads a context written before items were pruned as holding everything, so any edit can use it", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      edited(HOUR_WAIT, { reason: "{{ item.title }} was waiting" }),
    );
    test.operations.always("test.items", sourceResult([]));
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "an-earlier-engine",
      now: T0,
    });
    await test.store.parkItem(test.scope, {
      workflowId: id,
      itemId: "a",
      leasedBy: "an-earlier-engine",
      graphVersion: 1,
      nodeId: "pause",
      wake: { wait: "time", dueAt: minutesAfter(HOUR) },
      context: {
        data: { title: "Parked before pruning" },
        nodes: {},
        inbox: true,
        waitSince: T0,
      },
    });

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run.counts).toMatchObject({ woke: 1, graphChanged: 0 });
    expect(test.statuses.written[0].reason).toBe(
      "Parked before pruning was waiting",
    );
  });

  it("goes to a person the same way when the Wait now waits for something else", async () => {
    const { test, id } = await parkThenSave(
      edited({ wait: "reply", limitHours: 24 }),
    );

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run.counts).toMatchObject({
      needsManual: 1,
      graphChanged: 1,
    });
    expect(test.statuses.statusOf("a")).toBe("needs_manual");
    expect(test.threads.requests).toEqual([]);
  });

  it("carries on under the current graph when its Wait is still there with the same ports", async () => {
    const wait = { wait: "time", duration: { amount: 1, unit: "hours" } };
    const retuned = buildGraph({
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
        [
          "pause",
          "wait",
          { wait: "time", duration: { amount: 5, unit: "days" } },
        ],
        [
          "finish",
          "end",
          { outcome: "dismissed", reason: "edited graph decided" },
        ],
      ],
      edges: [
        ["start", "out", "src"],
        ["src", "out", "pause"],
        ["pause", "done", "finish"],
      ],
    });
    const { test, id } = await parkThenSave(retuned, wait);

    const result = await ranAt(test, id, minutesAfter(HOUR));

    // The wake it parked with (one hour) stands; what it does next is the new graph's.
    expect(result.run.counts).toMatchObject({ woke: 1, graphChanged: 0 });
    expect(test.statuses.written[0]).toMatchObject({
      status: "dismissed",
      reason: "edited graph decided",
    });
  });
});

describe("items a tick took and never finished", () => {
  it("are taken again once the lease their dead tick held has run out, and not before", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      buildGraph({
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
          ["finish", "end", { outcome: "done" }],
        ],
        edges: [
          ["start", "out", "src"],
          ["src", "out", "finish"],
        ],
      }),
    );
    test.operations.always("test.items", sourceResult([normalizedItem("a")]));
    // A tick took it and died: nobody released the lease.
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "dead-tick",
      now: T0,
    });

    const early = await ranAt(test, id, minutesAfter(5));
    expect(stepOf(early, "src").fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    expect(test.statuses.written).toEqual([]);

    const late = await ranAt(test, id, minutesAfter(20));
    expect(stepOf(late, "src").fields).toMatchObject({ taken: 1 });
    expect(test.statuses.statusOf("a")).toBe("resolved");
  });
});

describe("a parked item's context across a restart", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `r${index}`,
      body: `row ${index} ${"x".repeat(1500)}`,
    }));
  const lookupRows: [string, "lookup", Record<string, unknown>] = [
    "read",
    "lookup",
    {
      operation: "test.read",
      args: { key: { mode: "path", path: "item.title" } },
    },
  ];
  const HOUR_WAIT = { wait: "time", duration: { amount: 1, unit: "hours" } };

  async function parkAndRestart(ends?: Record<string, unknown>) {
    const state = createInMemoryStoreState();
    const first = makeHost({ state });
    first.operations.always("test.read", ok({ rows: rows(8) }));
    const { id } = await parkedAt(
      waitGraph(HOUR_WAIT, {
        before: [lookupRows],
        ...(ends ? { ends } : {}),
      }),
      [normalizedItem("a", { title: "Parked item" })],
      first,
    );
    const stored = (await stateOf(first, id))?.context;
    const restarted = makeHost({ state });
    restarted.clock.set(minutesAfter(HOUR));
    restarted.operations.always("test.items", sourceResult([]));
    return { first, restarted, id, stored };
  }

  it("keeps the one entry of a list a node after the Wait reads, and the node reads it after the restart", async () => {
    const { restarted, id, stored } = await parkAndRestart({
      reason: "{{ nodes.read.rows[2].id }} of {{ item.title }}",
    });

    // 8 rows of about 1.5 KB would not fit; the one that is read does, in its place.
    expect(stored).toMatchObject({
      nodes: { read: { rows: [null, null, { id: "r2" }] } },
      kept: ["item.title", "nodes.read.rows[2].id"],
    });
    const result = await ranAt(restarted, id, minutesAfter(HOUR));

    expect(result.run.counts).toMatchObject({ woke: 1, itemFailures: 0 });
    expect(restarted.statuses.written).toEqual([
      expect.objectContaining({
        itemId: "a",
        status: "resolved",
        reason: "r2 of Parked item",
      }),
    ]);
  });

  it("keeps the whole list when a node after the Wait reads the list, and fails the item with context_truncated when that does not fit", async () => {
    const test = makeHost();
    test.operations.always("test.read", ok({ rows: rows(8) }));
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    const { id } = await seedWorkflow(
      test,
      waitGraph(HOUR_WAIT, {
        before: [lookupRows],
        ends: { reason: "{{ nodes.read.rows }}" },
      }),
    );

    const parked = await ranAt(test, id, T0);

    expect(stepOf(parked, "pause")).toMatchObject({
      status: "failed",
      error: { code: "context_truncated" },
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
  });
});

describe("a tick key", () => {
  it("is still unique per workflow when a scheduled tick is delivered twice while its run is open", async () => {
    const { test, id } = await parkedAt(
      waitGraph({ wait: "time", duration: { amount: 1, unit: "hours" } }),
    );
    const instant = minutesAfter(HOUR);
    await test.store.startRun(test.scope, {
      workflowId: id,
      tickKey: instant,
      mode: "live",
      triggerKind: "schedule",
      startedBy: SCHEDULE_STARTER,
      graphVersion: 1,
    });

    const result = await tickAt(test, id, instant);

    expect(result.kind).toBe("duplicate_tick");
    expect((await stateOf(test, id))?.parkedAtNode).toBe("pause");
  });
});

// The engine does not trust a graph it cannot reason about.
describe("a graph that cannot run", () => {
  it("is refused with its issues before anything is looked at, so parked items wait for a graph that validates", async () => {
    const { test, id } = await parkedAt(
      waitGraph({ wait: "time", duration: { amount: 1, unit: "hours" } }),
    );
    const broken = waitGraph({
      wait: "time",
      duration: { amount: 1, unit: "hours" },
    });
    broken.edges.pop();
    await test.store.saveWorkflowGraph(test.scope, {
      workflowId: id,
      expectedVersion: 1,
      graph: broken,
      source: "save",
      summary: "leaves a port leading nowhere",
      createdBy: "owner@example.test",
    });
    await reenable(test, id);

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run).toMatchObject({
      status: "failed",
      error: { code: "graph_invalid" },
    });
    expect((await stateOf(test, id))?.parkedAtNode).toBe("pause");
    expect((await stateOf(test, id))?.leasedBy).toBeUndefined();
    expect(WorkflowError).toBeDefined();
  });
});

describe("a parked item the engine cannot trust", () => {
  const hourWait = () =>
    waitGraph({ wait: "time", duration: { amount: 1, unit: "hours" } });

  it("hands the item to a person when a due wake's context is gone", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, hourWait());
    test.operations.always("test.items", sourceResult([]));
    await test.store.leaseItems(test.scope, {
      workflowId: id,
      graphVersion: 1,
      itemIds: ["a"],
      leasedBy: "an-earlier-tick",
      now: T0,
    });
    await test.store.parkItem(test.scope, {
      workflowId: id,
      itemId: "a",
      leasedBy: "an-earlier-tick",
      graphVersion: 1,
      nodeId: "pause",
      wake: { wait: "time", dueAt: minutesAfter(HOUR) },
      context: {},
    });

    const result = await ranAt(test, id, minutesAfter(HOUR));

    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts).toMatchObject({
      woke: 0,
      itemFailures: 1,
      needsManual: 1,
    });
    // Nothing is known about the item beyond its id, so no inbox row is touched.
    expect(test.statuses.written).toEqual([]);
    expect((await stateOf(test, id))?.parkedAtNode).toBeUndefined();
    expect(
      (await eventsOf(test, id, "a")).map(
        (event) => `${event.kind}:${event.outcome ?? event.code ?? ""}`,
      ),
    ).toEqual(["error:engine_error", "ended:needsManual"]);
  });

  it("fails the run with the store's own error when a parked item's row went while its tick held it", async () => {
    const state = createInMemoryStoreState();
    const { test, id } = await parkedAt(
      hourWait(),
      [normalizedItem("a")],
      makeHost({ state }),
    );
    const losing: TestHost = {
      ...test,
      host: {
        ...test.host,
        store: {
          ...test.store,
          leaseItems: async (scope, input) => {
            const won = await test.store.leaseItems(scope, input);
            state.itemStates.clear();
            return won;
          },
        },
      },
    };

    await expect(ranAt(losing, id, minutesAfter(HOUR))).rejects.toMatchObject({
      code: "not_found",
    });

    const [run] = (await test.store.listRuns(test.scope, { workflowId: id }))
      .items;
    expect(run).toMatchObject({
      status: "failed",
      error: { code: "engine_error" },
    });
  });

  it("carries on as before when a second tick runs on the same workflow", async () => {
    const { test, id } = await parkedAt(hourWait(), [normalizedItem("a")]);
    // Another tick takes the item after this one has listed it as free.
    const outpaced: TestHost = {
      ...test,
      host: {
        ...test.host,
        store: {
          ...test.store,
          listDueParked: async (scope, input) => {
            const due = await test.store.listDueParked(scope, input);
            await test.store.leaseItems(scope, {
              workflowId: id,
              graphVersion: 1,
              itemIds: ["a"],
              leasedBy: "another-tick",
              now: input.now,
            });
            return due;
          },
        },
      },
    };

    const lost = await ranAt(outpaced, id, minutesAfter(HOUR));

    expect(lost.passes.resumed).toBe(1);
    expect(lost.run.counts).toMatchObject({ woke: 0, done: 0 });
    expect((await stateOf(test, id))?.leasedBy).toBe("another-tick");

    // The same tick key again while its run is still open.
    const instant = minutesAfter(HOUR + 30);
    const { run } = await test.store.startRun(test.scope, {
      workflowId: id,
      tickKey: instant,
      mode: "live",
      triggerKind: "schedule",
      startedBy: SCHEDULE_STARTER,
      graphVersion: 1,
      startedAt: minutesAfter(HOUR + 20),
    });

    const second = await tickAt(test, id, instant);

    expect(second).toEqual({ kind: "duplicate_tick", run });
  });

  it("skips items that are merely parked, and answers a tick key a dead run still holds as a duplicate", async () => {
    const { test, id } = await parkedAt(hourWait(), [normalizedItem("a")]);
    // The source offers the parked item again, so the step counts it as skipped.
    test.operations.always("test.items", sourceResult([normalizedItem("a")]));

    const offered = await ranAt(test, id, minutesAfter(30));
    expect(stepOf(offered, "src").fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    const woke = await ranAt(test, id, minutesAfter(HOUR));
    expect(woke.passes.resumed).toBe(1);

    // Started past a lease's lifetime ago and never finished: a tick that died.
    const instant = minutesAfter(HOUR + 60);
    await test.store.startRun(test.scope, {
      workflowId: id,
      tickKey: instant,
      mode: "live",
      triggerKind: "schedule",
      startedBy: SCHEDULE_STARTER,
      graphVersion: 1,
      startedAt: minutesAfter(HOUR + 40),
    });

    expect(await tickAt(test, id, instant)).toMatchObject({
      kind: "duplicate_tick",
    });
  });
});
