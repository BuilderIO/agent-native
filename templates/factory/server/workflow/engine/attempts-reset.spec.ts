import { describe, expect, it } from "vitest";

import {
  chain,
  endWith,
  eventsOf,
  minutesAfter,
  normalizedItem,
  ran,
  sourceResult,
  T0,
  threadedItem,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { failure, ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const lookup = [
  "look",
  "lookup",
  { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
] as const;

const blip = () => failure("provider_error", { retryable: true });

async function standingItem(end = endWith("released")) {
  const test = makeHost();
  const { id } = await seedWorkflow(test, chain([[...lookup]], { end }));
  test.operations.always(
    "test.items",
    sourceResult([normalizedItem("task-1")]),
  );
  return { test, id };
}

const attemptsOf = async (
  test: Awaited<ReturnType<typeof standingItem>>["test"],
  id: string,
) =>
  (await test.store.getItemState(test.scope, id, "task-1"))?.counters
    .attempts ?? 0;

describe("the attempts an item has spent", () => {
  it("start again from nothing once it has come through the node it failed at", async () => {
    const { test, id } = await standingItem(endWith("done"));
    test.operations.script("test.read", blip(), blip(), blip());
    test.operations.always("test.read", ok({ v: 1 }));

    const first = await ran(test, id);
    expect(first.run.counts).toMatchObject({ retryParked: 1 });
    expect(await attemptsOf(test, id)).toBe(1);

    test.clock.set(minutesAfter(6));
    const second = await ran(test, id);

    expect(second.run.counts).toMatchObject({ retried: 1, done: 1 });
    expect(await attemptsOf(test, id)).toBe(0);
  });

  it("start again from nothing when the item is released, whatever happened to it before", async () => {
    const { test, id } = await standingItem();
    test.operations.script("test.read", blip(), blip(), blip());
    test.operations.always("test.read", ok({ v: 1 }));

    await ran(test, id);
    test.clock.set(minutesAfter(6));
    await ran(test, id);

    expect(await attemptsOf(test, id)).toBe(0);
  });

  it("do not add up over the days of a long-lived item, so a third blip is retried like the first", async () => {
    const { test, id } = await standingItem();
    const script = [];
    for (let blips = 0; blips < 3; blips += 1) {
      script.push(blip(), blip(), blip());
      for (let healthy = 0; healthy < 6; healthy += 1)
        script.push(ok({ v: 1 }));
    }
    test.operations.script("test.read", ...script);
    test.operations.always("test.read", ok({ v: 1 }));

    const parked: number[] = [];
    for (let tick = 0; tick < 30; tick += 1) {
      const result = await ran(test, id);
      expect(result.run.counts.needsManual).toBe(0);
      if (result.run.counts.retryParked) parked.push(tick);
      test.clock.advance(12 * 60_000);
    }

    expect(parked).toHaveLength(3);
    const trail = (await eventsOf(test, id, "task-1")).filter(
      (event) => event.kind === "ended",
    );
    expect(trail.every((event) => event.outcome === "released")).toBe(true);
  });

  it("still hand an item to a person when one visit fails three times in a row", async () => {
    const { test, id } = await standingItem(endWith("done"));
    test.operations.always("test.read", blip());

    await ran(test, id);
    test.clock.set(minutesAfter(6));
    await ran(test, id);
    test.clock.set(minutesAfter(20));
    const third = await ran(test, id);

    expect(third.run.counts).toMatchObject({ needsManual: 1 });
    expect(await attemptsOf(test, id)).toBe(3);
  });
});

describe("the looks at a thread that failed", () => {
  it("are counted from the first one after the last that worked, not from the first ever", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      waitGraph({ wait: "reply", limitHours: 24, acceptFrom: "anyone" }),
    );
    test.operations.script("test.items", sourceResult([threadedItem("r1")]));
    test.operations.always("test.items", sourceResult([]));
    await ran(test, id);

    // Looks every 15 minutes; patience runs out after two hours of failing looks.
    const look = async (minutes: number, fails: boolean) => {
      if (fails) test.threads.failNext(3, { retryable: true });
      test.clock.set(minutesAfter(minutes, T0));
      return ran(test, id);
    };
    const results = [];
    // Six failing looks (75 minutes), one that works, six more failing looks.
    for (let index = 1; index <= 6; index += 1) {
      results.push(await look(index * 15, true));
    }
    results.push(await look(7 * 15, false));
    for (let index = 8; index <= 13; index += 1) {
      results.push(await look(index * 15, true));
    }

    expect(results.map((result) => result.run.counts.needsManual)).toEqual(
      Array(results.length).fill(0),
    );
    expect(results[results.length - 1].run.counts).toMatchObject({
      stillWaiting: 1,
    });
  });
});
