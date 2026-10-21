import { describe, expect, it } from "vitest";

import type { NodeSpec } from "../story-graphs.fixture.js";
import {
  T0,
  eventsOf,
  minutesAfter,
  normalizedItem,
  ranAt,
  sourceResult,
  tickAt,
  threadOf,
  threadedItem,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const SLOW_STEP_MS = 40_000;

const slowLookup = (): NodeSpec => [
  "slow",
  "lookup",
  { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
];

/**
 * The first tick starts at 12:00 and is still reading when the item reaches
 * its Wait, 40 seconds in: the park time is not the tick's time.
 */
async function parkedAfterASlowStep(wait: Record<string, unknown>) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    waitGraph(wait, {
      before: [slowLookup()],
      settings: { checkCadenceMinutes: 5 },
    }),
  );
  test.operations.script("test.items", sourceResult([threadedItem("a")]));
  test.operations.always("test.items", sourceResult([]));
  test.operations.always("test.read", () => {
    test.clock.advance(SLOW_STEP_MS);
    return ok({ v: 1 });
  });
  const first = await ranAt(test, id, T0);
  expect(first.run.counts).toMatchObject({ parked: 1 });
  return { test, id };
}

const parkedRow = async (
  test: Awaited<ReturnType<typeof parkedAfterASlowStep>>["test"],
  id: string,
) => {
  const [row] = await test.store.listDueParked(test.scope, {
    workflowId: id,
    now: "2099-01-01T00:00:00.000Z",
    limit: 5,
  });
  return row;
};

describe("when a parked item is next looked at", () => {
  it("counts a reply check from the tick that parked it, not from the moment it was parked", async () => {
    const { test, id } = await parkedAfterASlowStep({
      wait: "reply",
      limitHours: 2,
      acceptFrom: "anyone",
    });

    expect((await parkedRow(test, id)).wake).toMatchObject({
      wait: "reply",
      nextCheckAt: minutesAfter(5),
      dueAt: minutesAfter(120),
    });
  });

  it("finds a reply on the very next tick, even though that tick came at the cadence and the item was parked late in the first", async () => {
    const { test, id } = await parkedAfterASlowStep({
      wait: "reply",
      limitHours: 2,
      acceptFrom: "anyone",
    });
    test.threads.post(threadOf("a"), {
      at: minutesAfter(3),
      author: "person@example.test",
      text: "on it",
    });

    const second = await ranAt(test, id, minutesAfter(5));

    expect(second.passes.resumed).toBe(1);
    expect(second.run.counts).toMatchObject({ woke: 1, done: 1 });
    expect(
      (await eventsOf(test, id, "a")).some((event) => event.kind === "ended"),
    ).toBe(true);
  });

  it("counts a time wait from the tick that parked it, so the tick one length later ends it", async () => {
    const { test, id } = await parkedAfterASlowStep({
      wait: "time",
      duration: { amount: 10, unit: "minutes" },
    });

    expect((await parkedRow(test, id)).wake).toEqual({
      wait: "time",
      dueAt: minutesAfter(10),
    });
    const tenMinutesOn = await ranAt(test, id, minutesAfter(10));

    expect(tenMinutesOn.passes.resumed).toBe(1);
    expect(tenMinutesOn.run.counts).toMatchObject({ woke: 1, done: 1 });
  });

  it("counts the deadline of a reply wait from the tick too, so it times out when the tick that is due for it comes", async () => {
    const { test, id } = await parkedAfterASlowStep({
      wait: "reply",
      limitHours: 0.25,
      acceptFrom: "anyone",
    });

    expect((await parkedRow(test, id)).wake?.dueAt).toBe(minutesAfter(15));
  });

  it("counts the next check of an item that was looked at and is still waiting from the tick that looked", async () => {
    const { test, id } = await parkedAfterASlowStep({
      wait: "reply",
      limitHours: 2,
      acceptFrom: "anyone",
    });

    const read = test.threads.readReplies.bind(test.threads);
    test.threads.readReplies = async (request) => {
      test.clock.advance(SLOW_STEP_MS);
      return read(request);
    };
    await ranAt(test, id, minutesAfter(5));

    expect((await parkedRow(test, id)).wake?.nextCheckAt).toBe(
      minutesAfter(10),
    );
  });
});

describe("a tick that comes a little early", () => {
  async function parkedForFiveMinutes() {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(
        { wait: "time", duration: { amount: 5, unit: "minutes" } },
        { settings: { checkCadenceMinutes: 5 } },
      ),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.always("test.items", sourceResult([]));
    await ranAt(test, id, T0);
    return { test, id };
  }

  it("picks up an item that falls due a few seconds after it starts, instead of leaving it another whole cadence", async () => {
    const { test, id } = await parkedForFiveMinutes();

    // 20 seconds short of the five minutes: scheduler jitter, not a reason to wait five more.
    const result = await ranAt(test, id, minutesAfter(5 - 20 / 60));

    expect(result.run.counts).toMatchObject({ woke: 1, done: 1 });
    expect(result.passes).toEqual({ trigger: false, resumed: 1 });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBeUndefined();
  });

  it("does not wake an item that is not close to due: an early tick is not a wrong one", async () => {
    const { test, id } = await parkedForFiveMinutes();

    const result = await tickAt(test, id, minutesAfter(5 - 90 / 60));

    expect(result.kind).toBe("nothing_due");
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.parkedAtNode,
    ).toBe("pause");
  });

  it("is a tenth of the cadence at most, so a graph that checks every five minutes forgives thirty seconds and no more", async () => {
    const { test, id } = await parkedForFiveMinutes();

    expect((await tickAt(test, id, minutesAfter(5 - 35 / 60))).kind).toBe(
      "nothing_due",
    );
    expect(
      (await ranAt(test, id, minutesAfter(5 - 30 / 60))).run.counts,
    ).toMatchObject({ woke: 1 });
  });
});
