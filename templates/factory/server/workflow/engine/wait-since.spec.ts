import { describe, expect, it } from "vitest";

import {
  T0,
  minutesAfter,
  ran,
  sourceResult,
  threadOf,
  threadedItem,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";

const ask = [
  "ask",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "Can you give a repro?" } },
  },
] as const;

const seconds = (count: number) => new Date(Date.parse(T0) + count * 1000);

async function askedAndWaiting(itemIds: string[], secondsPerPost: number) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    waitGraph(
      { wait: "reply", limitHours: 24, acceptFrom: "anyone" },
      { before: [[...ask]] },
    ),
  );
  test.operations.script(
    "test.items",
    sourceResult(itemIds.map((item) => threadedItem(item))),
  );
  test.operations.always("test.items", sourceResult([]));
  // Posting takes a while: the clock moves inside each write.
  test.operations.always("test.write", () => {
    test.clock.advance(secondsPerPost * 1000);
    return ok({}, { externalRef: "q" });
  });
  return { test, id };
}

describe("when a reply Wait starts listening", () => {
  it("is when the question went out, not when the tick began, so a message posted before it does not answer it", async () => {
    const { test, id } = await askedAndWaiting(["r1"], 60);
    // The reporter adds a follow-up 30 seconds in; the question goes out at 60.
    test.threads.post(threadOf("r1"), {
      at: seconds(30).toISOString(),
      author: "reporter@x.test",
      text: "also happens on Safari",
    });

    const first = await ran(test, id);
    test.clock.set(minutesAfter(40));
    const second = await ran(test, id);

    expect(first.run.counts).toMatchObject({ parked: 1 });
    expect(test.threads.requests[0].since).toBe(seconds(60).toISOString());
    expect(second.run.counts).toMatchObject({ woke: 0, stillWaiting: 1 });
  });

  it("still counts a message posted after the question", async () => {
    const { test, id } = await askedAndWaiting(["r1"], 60);
    test.threads.post(threadOf("r1"), {
      at: seconds(90).toISOString(),
      author: "reporter@x.test",
      text: "here is the repro",
    });

    await ran(test, id);
    test.clock.set(minutesAfter(40));
    const second = await ran(test, id);

    expect(second.run.counts).toMatchObject({ woke: 1 });
  });

  it("is the moment each item's own question went out, so the first of a batch does not lose an early answer", async () => {
    const { test, id } = await askedAndWaiting(["r1", "r2"], 30);
    // r1's question went out at 30 seconds and r2's at 60; both are parked at 60.
    test.threads.post(threadOf("r1"), {
      at: seconds(45).toISOString(),
      author: "reporter@x.test",
      text: "answer to the first",
    });
    test.threads.post(threadOf("r2"), {
      at: seconds(45).toISOString(),
      author: "reporter@x.test",
      text: "said before the second question",
    });

    await ran(test, id);
    test.clock.set(minutesAfter(40));
    const second = await ran(test, id);

    expect(second.run.counts).toMatchObject({ woke: 1, stillWaiting: 1 });
    const woken = await Promise.all(
      ["r1", "r2"].map(async (item) => ({
        item,
        parked: (await test.store.getItemState(test.scope, id, item))
          ?.parkedAtNode,
      })),
    );
    expect(woken).toEqual([
      { item: "r1", parked: undefined },
      { item: "r2", parked: "pause" },
    ]);
  });

  it("keeps the deadline and the next look counted from the start of the tick", async () => {
    const { test, id } = await askedAndWaiting(["r1"], 60);

    await ran(test, id);

    const state = await test.store.getItemState(test.scope, id, "r1");
    expect(state?.wake?.dueAt).toBe(minutesAfter(24 * 60));
    expect(state?.wake?.nextCheckAt).toBe(minutesAfter(15));
  });
});
