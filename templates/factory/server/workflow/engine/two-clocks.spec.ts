import { describe, expect, it } from "vitest";

import {
  T0,
  chain,
  minutesAfter,
  normalizedItem,
  ran,
  ranAt,
  sourceResult,
  stepOf,
  tickAt,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const HOURLY = { schedule: { every: "60m" } };

async function setup(
  wait: Record<string, unknown>,
  trigger: Record<string, unknown> = HOURLY,
) {
  const test = makeHost();
  const { id } = await seedWorkflow(test, waitGraph(wait, { trigger }));
  test.operations.script("test.items", sourceResult([normalizedItem("a")]));
  test.operations.always("test.items", sourceResult([]));
  // The first tick parks the item, at 12:00, an hourly instant.
  const first = await ranAt(test, id, T0);
  expect(first.run.counts).toMatchObject({ parked: 1 });
  return { test, id };
}

const runCount = async (
  test: Awaited<ReturnType<typeof setup>>["test"],
  id: string,
) => (await test.store.listRuns(test.scope, { workflowId: id })).items.length;

const lastTriggerAt = async (
  test: Awaited<ReturnType<typeof setup>>["test"],
  id: string,
) => (await test.store.getWorkflow(test.scope, id))?.lastTriggerAt;

const twentyMinutes = {
  wait: "time",
  duration: { amount: 20, unit: "minutes" },
};
const oneHour = { wait: "time", duration: { amount: 1, unit: "hours" } };

describe("a graph with a Wait is ticked more often than its Trigger fires", () => {
  it("runs only the resume pass when a parked item is due and the Trigger is not", async () => {
    const { test, id } = await setup(twentyMinutes);
    const sourceReads = test.operations.callsTo("test.items").length;

    const result = await ranAt(test, id, minutesAfter(30));

    expect(result.passes).toEqual({ trigger: false, resumed: 1 });
    // The Trigger and the source did not run; the Wait woke the item and the End finished it.
    expect(result.steps.map((step) => step.nodeId)).toEqual([
      "pause",
      "end_done",
    ]);
    expect(test.operations.callsTo("test.items")).toHaveLength(sourceReads);
    expect(result.run.counts).toMatchObject({ woke: 1, done: 1, taken: 0 });
    // A tick that did not fire the Trigger leaves the last firing where it was.
    expect(await lastTriggerAt(test, id)).toBe(T0);
  });

  it("runs only the new-items pass when the Trigger is due and nothing is parked that is due", async () => {
    const { test, id } = await setup({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });

    const result = await ranAt(test, id, minutesAfter(60));

    expect(result.passes).toEqual({ trigger: true, resumed: 0 });
    expect(result.steps.map((step) => step.nodeId)).toContain("src");
    expect(await lastTriggerAt(test, id)).toBe(minutesAfter(60));
  });

  it("runs both passes when the Trigger fires on the tick a parked item is due", async () => {
    const { test, id } = await setup(oneHour);
    test.operations.script("test.items", sourceResult([normalizedItem("b")]));

    const result = await ranAt(test, id, minutesAfter(60));

    expect(result.passes).toEqual({ trigger: true, resumed: 1 });
    expect(result.run.counts).toMatchObject({ taken: 1, parked: 1, woke: 1 });
    // One Wait step for both: it woke the old item and parked the new one.
    expect(stepOf(result, "pause")).toMatchObject({
      ports: { done: { itemIds: ["a"] }, parked: { itemIds: ["b"] } },
    });
  });

  it("does nothing, and records no run, when the Trigger is not due and nothing is parked that is due", async () => {
    const { test, id } = await setup({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });
    const runs = await runCount(test, id);
    const sourceReads = test.operations.callsTo("test.items").length;
    const writesBefore = test.statuses.written.length;

    const result = await tickAt(test, id, minutesAfter(15));

    expect(result).toEqual({
      kind: "nothing_due",
      message: expect.stringContaining("Nothing due"),
    });
    expect(await runCount(test, id)).toBe(runs);
    expect(test.operations.callsTo("test.items")).toHaveLength(sourceReads);
    expect(test.statuses.written).toHaveLength(writesBefore);
    expect(await lastTriggerAt(test, id)).toBe(T0);
  });

  it("is quiet for as long as nothing is due, tick after tick", async () => {
    const { test, id } = await setup({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });

    const kinds: string[] = [];
    for (const minutes of [15, 30, 45]) {
      kinds.push((await tickAt(test, id, minutesAfter(minutes))).kind);
    }

    expect(kinds).toEqual(["nothing_due", "nothing_due", "nothing_due"]);
    expect(await runCount(test, id)).toBe(1);
  });

  it("collapses the ticks missed during downtime into one run that covers the whole gap", async () => {
    const { test, id } = await setup({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });

    // Nothing ticked from 13:00 to 16:15; the scheduler fires once on recovery.
    const result = await ranAt(test, id, minutesAfter(4 * 60 + 15));

    expect(result.passes.trigger).toBe(true);
    expect(stepOf(result, "start").fields).toMatchObject({
      windowStart: T0,
      windowEnd: minutesAfter(4 * 60),
    });
    expect(await runCount(test, id)).toBe(2);
    expect(await lastTriggerAt(test, id)).toBe(minutesAfter(4 * 60));
    // And that run used up every instant it covered.
    const next = await tickAt(test, id, minutesAfter(4 * 60 + 30));
    expect(next.kind).toBe("nothing_due");
  });

  it("keys the run by the tick but ends the window at the Trigger's own instant", async () => {
    const { test, id } = await setup({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });

    const result = await ranAt(test, id, minutesAfter(75));

    expect(result.run.tickKey).toBe(minutesAfter(75));
    expect(stepOf(result, "start").fields).toMatchObject({
      windowEnd: minutesAfter(60),
      scheduledFor: minutesAfter(75),
    });
  });

  it("always runs the new-items pass for a manual run, and moves the last firing to now", async () => {
    const { test, id } = await setup({
      wait: "time",
      duration: { amount: 3, unit: "days" },
    });
    test.clock.set(minutesAfter(20));

    const result = await ran(test, id);

    expect(result.passes).toEqual({ trigger: true, resumed: 0 });
    expect(await lastTriggerAt(test, id)).toBe(minutesAfter(20));
  });

  it("does not fire a Trigger that has never fired for an instant it missed long ago", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(
        { wait: "time", duration: { amount: 3, unit: "days" } },
        {
          trigger: {
            schedule: { daily: { at: "07:00" } },
            timezone: "UTC",
          },
        },
      ),
    );

    // 12:00 UTC: 07:00 passed five hours ago, and this is the first tick since the workflow was enabled.
    const result = await tickAt(test, id, T0);

    expect(result.kind).toBe("nothing_due");
    expect(await runCount(test, id)).toBe(0);
  });

  it("fires a time-of-day Trigger in its own time zone", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph(
        { wait: "time", duration: { amount: 3, unit: "days" } },
        {
          trigger: {
            schedule: { weekdays: { at: "08:00" } },
            timezone: "America/New_York",
          },
        },
      ),
    );
    test.operations.always("test.items", sourceResult([]));

    // 08:15 on Monday in New York is 12:15 UTC: the 08:00 instant is 15 minutes old.
    const result = await ranAt(test, id, minutesAfter(15));

    expect(result.passes.trigger).toBe(true);
    expect(stepOf(result, "start").fields).toMatchObject({ windowEnd: T0 });
    expect((await tickAt(test, id, minutesAfter(30))).kind).toBe("nothing_due");
  });
});

describe("a graph with no Wait", () => {
  it("is ticked at its Trigger's cadence, and a tick that lands between instants has nothing due", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    await ranAt(test, id, T0);

    expect((await tickAt(test, id, minutesAfter(3))).kind).toBe("nothing_due");
    const next = await ranAt(test, id, minutesAfter(5));

    expect(next.passes).toEqual({ trigger: true, resumed: 0 });
    expect(await runCount(test, id)).toBe(2);
  });
});
