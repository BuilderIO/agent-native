import { describe, expect, it } from "vitest";

import { receiptKey } from "../../contract.js";
import type { NodeSpec } from "../../story-graphs.fixture.js";
import {
  chain,
  eventsOf,
  minutesAfter,
  normalizedItem,
  providerQuery,
  ran,
  ranAt,
  sourceResult,
  stepOf,
  T0,
} from "../../testing/engine-fixtures.js";
import { ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";
import { combinedItemId, groupItemId } from "./combine.js";

const post = (): NodeSpec => [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "digest" } },
  },
];

const lookupAfter = (): NodeSpec => [
  "after",
  "lookup",
  { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
];

const listId = (nodeId: string, memberIds: string[], windowStart = T0) =>
  combinedItemId({ kind: "list", nodeId, memberIds, windowStart });

/** The state a run leaves when it sent the post and stopped before it could finish: a closed receipt for the post of `itemId`. */
async function leaveDoneReceipt(
  test: Awaited<ReturnType<typeof digestHost>>["test"],
  workflowId: string,
  itemId: string,
) {
  const key = receiptKey({ workflowId, itemId, nodeId: "post", attempt: 0 });
  await test.store.putReceipt(test.scope, workflowId, {
    key,
    status: "started",
    at: T0,
  });
  await test.store.putReceipt(test.scope, workflowId, {
    key,
    status: "done",
    externalRef: "msg-0",
    at: T0,
  });
}

/** source -> a combine named `digest` -> a post -> a lookup, so a run can stop between the post and the end. */
async function digestHost(
  combine: Record<string, unknown>,
  /** Offers the same items again whether or not they were handled. */
  options: { remember?: boolean } = {},
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain([["digest", "combine", combine], post(), lookupAfter()], {
      ...(options.remember === false
        ? { source: providerQuery({ memory: "none" }) }
        : {}),
    }),
  );
  test.operations.always("test.write", ok({}, { externalRef: "msg-1" }));
  test.operations.always("test.read", ok({ v: 1 }));
  return {
    test,
    id,
    writes: () => test.operations.callsTo("test.write").length,
  };
}

describe("the identity of an item a combine makes", () => {
  it("is the same when the same window is read again, so its write is not sent twice", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "list" },
      { remember: false },
    );
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("a1")]),
      sourceResult([normalizedItem("a1")]),
    );

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(stepOf(first, "digest").ports.out.itemIds).toEqual(
      stepOf(second, "digest").ports.out.itemIds,
    );
    expect(writes()).toBe(1);
    expect(stepOf(second, "post").fields?.reused).toBe(1);
  });

  it("finds the receipt an earlier run left, whatever run it was", async () => {
    const { test, id, writes } = await digestHost({ mode: "list" });
    test.operations.script("test.items", sourceResult([normalizedItem("a1")]));
    await leaveDoneReceipt(
      test,
      id,
      combinedItemId({
        kind: "list",
        nodeId: "digest",
        memberIds: ["a1"],
        windowStart: T0,
      }),
    );

    const result = await ran(test, id);

    expect(writes()).toBe(0);
    expect(stepOf(result, "post").fields?.reused).toBe(1);
  });

  it("is the same for the same items in any order", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "count" },
      { remember: false },
    );
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("a1"), normalizedItem("a2")]),
      sourceResult([normalizedItem("a2"), normalizedItem("a1")]),
    );

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(stepOf(first, "digest").ports.out.itemIds).toEqual(
      stepOf(second, "digest").ports.out.itemIds,
    );
    expect(writes()).toBe(1);
  });

  it("is not shared with a digest of other items, even when they overlap", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "list" },
      { remember: false },
    );
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("a1")]),
      sourceResult([normalizedItem("a1"), normalizedItem("a2")]),
    );

    await ran(test, id);
    const second = await ran(test, id);

    expect(writes()).toBe(2);
    expect(stepOf(second, "post").fields?.reused).toBeUndefined();
  });

  it("keeps a summed total for a service on another day from reading as already posted", async () => {
    const { test, id, writes } = await digestHost({
      mode: "summarize",
      summarize: {
        group: "item.extras.service",
        value: "item.extras.cost",
        agg: "sum",
      },
    });
    test.operations.script(
      "test.items",
      sourceResult([
        normalizedItem("day1", { extras: { service: "s3", cost: 5 } }),
      ]),
      sourceResult([
        normalizedItem("day2", { extras: { service: "s3", cost: 9 } }),
      ]),
    );

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(writes()).toBe(2);
    expect(stepOf(first, "digest").ports.out.itemIds).not.toEqual(
      stepOf(second, "digest").ports.out.itemIds,
    );
    expect(stepOf(second, "post").fields?.reused).toBeUndefined();
  });

  it("keeps a group one standing item per key, whoever its members are, so what is counted on it stays counted", async () => {
    const { test, id } = await digestHost({
      mode: "groupBy",
      key: "item.extras.service",
    });
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("d1", { extras: { service: "s3" } })]),
      sourceResult([normalizedItem("d2", { extras: { service: "s3" } })]),
    );

    const first = await ran(test, id);
    const second = await ran(test, id);

    expect(stepOf(first, "digest").ports.out.itemIds).toEqual(
      stepOf(second, "digest").ports.out.itemIds,
    );
    expect(
      (
        await eventsOf(test, id, stepOf(first, "digest").ports.out.itemIds[0])
      ).filter((event) => event.kind === "ended"),
    ).toHaveLength(2);
  });

  it("makes a group's write for each set of members, so the rows of another day are sent", async () => {
    const { test, id, writes } = await digestHost({
      mode: "groupBy",
      key: "item.extras.service",
    });
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("d1", { extras: { service: "s3" } })]),
      sourceResult([normalizedItem("d2", { extras: { service: "s3" } })]),
    );

    await ran(test, id);
    const second = await ran(test, id);

    expect(writes()).toBe(2);
    expect(stepOf(second, "post").fields?.reused).toBeUndefined();
  });

  it("does not send a group's write again for the same members, in whatever order they come", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "groupBy", key: "item.extras.service" },
      { remember: false },
    );
    const rows = ["d1", "d2"].map((name) =>
      normalizedItem(name, { extras: { service: "s3" } }),
    );
    test.operations.script(
      "test.items",
      sourceResult(rows),
      sourceResult([...rows].reverse()),
    );

    await ran(test, id);
    const second = await ran(test, id);

    expect(writes()).toBe(1);
    expect(stepOf(second, "post").fields?.reused).toBe(1);
  });

  it("sends a daily digest for every service on every day", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "groupBy", key: "item.extras.service" },
      { remember: false },
    );
    const day = (name: string, service: string, n: number) =>
      normalizedItem(`${name}-${service}-${n}`, { extras: { service } });
    test.operations.script(
      "test.items",
      sourceResult([day("d1", "api", 1), day("d1", "web", 1)]),
      sourceResult([
        day("d2", "api", 1),
        day("d2", "web", 1),
        day("d2", "web", 2),
      ]),
    );

    const first = await ran(test, id);
    const afterFirst = writes();
    const second = await ran(test, id);

    expect(afterFirst).toBe(2);
    expect(writes()).toBe(4);
    expect(first.run.status).toBe("succeeded");
    expect(second.run.status).toBe("succeeded");
    expect(second.run.counts).toMatchObject({ done: 2 });
  });

  it("sends a group of groups for the rows of each day, though the inner groups keep their ids", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          ["inner", "combine", { mode: "groupBy", key: "item.extras.service" }],
          ["outer", "combine", { mode: "groupBy", key: "item.extras.region" }],
          post(),
        ],
        { source: providerQuery({ memory: "none" }) },
      ),
    );
    const day = (name: string) =>
      ["api", "web"].map((service) =>
        normalizedItem(`${name}-${service}`, {
          extras: { service, region: "eu" },
        }),
      );
    test.operations.script(
      "test.items",
      sourceResult(day("d1")),
      sourceResult(day("d2")),
      sourceResult(day("d2")),
    );
    test.operations.always("test.write", ok({}, { externalRef: "msg-1" }));

    await ran(test, id);
    await ran(test, id);
    // The same day's rows again is not a second send.
    await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(2);
  });

  it("keeps a group's write for its members when the group waits for the next run", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "groupBy", key: "item.extras.service" },
      { remember: false },
    );
    const rows = [normalizedItem("d1", { extras: { service: "s3" } })];
    test.operations.script(
      "test.items",
      sourceResult(rows),
      sourceResult(rows),
    );
    // Closed after the post, before the End: the next run finds the write done.
    test.stopWhen(
      () =>
        test.operations.callsTo("test.write").length > 0 &&
        test.operations.callsTo("test.read").length === 0,
    );

    await ran(test, id);
    test.stopWhen(() => false);
    await ran(test, id);

    expect(writes()).toBe(1);
  });

  it("keeps a pull request under a new head from reading as the merge already done", async () => {
    const { test, id, writes } = await digestHost(
      { mode: "groupBy", key: "item.extras.head" },
      { remember: false },
    );
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("pr-1", { extras: { head: "aaa" } })]),
      sourceResult([normalizedItem("pr-1", { extras: { head: "bbb" } })]),
      sourceResult([normalizedItem("pr-1", { extras: { head: "bbb" } })]),
    );

    await ran(test, id);
    await ran(test, id);
    await ran(test, id);

    // A new head is a new group; the same head again is the same one.
    expect(writes()).toBe(2);
  });

  it("is scoped to its own node, so two combines over the same items never share a write", () => {
    expect(listId("morning", ["a1"])).not.toBe(listId("evening", ["a1"]));
  });

  it("is short, and names the kind and the node so a journey can say what it is", () => {
    const id = combinedItemId({
      kind: "summary",
      nodeId: "byService",
      memberIds: ["a1", "a2"],
      key: "s3",
    });

    expect(id).toMatch(/^summary:byService:[0-9a-f]{1,14}$/);
  });

  it("never lets two different member lists blur into one", () => {
    expect(listId("n", ["ab", "c"])).not.toBe(listId("n", ["a", "bc"]));
    expect(listId("n", ["a,b"])).not.toBe(listId("n", ["a", "b"]));
  });

  it("holds when the members' own ids carry colons, as ids scoped to a source do", () => {
    const scoped = ["slack:C1:1760000000.000100", "slack:C1:1760000000.000200"];

    expect(listId("n", scoped)).toBe(listId("n", [...scoped].reverse()));
  });

  it("does not let the window matter when there are members, so a late retry still finds its write", () => {
    expect(listId("n", ["a1"], T0)).toBe(listId("n", ["a1"], minutesAfter(5)));
  });

  it("tells one group key from another, and is the same for the same key", () => {
    expect(groupItemId("n", "aaa")).not.toBe(groupItemId("n", "bbb"));
    expect(groupItemId("n", "aaa")).toBe(groupItemId("n", "aaa"));
  });

  it("tells a summary from the same members under another group key", () => {
    const summary = (key: string) =>
      combinedItemId({ kind: "summary", nodeId: "n", memberIds: ["r1"], key });

    expect(summary("s3")).not.toBe(summary("ec2"));
  });
});

describe("a digest over nothing", () => {
  it("is said again in the next window, because 'nothing happened' is news each time", async () => {
    const { test, id, writes } = await digestHost({ mode: "count" });
    test.operations.always("test.items", sourceResult([]));

    await ranAt(test, id, T0);
    await ranAt(test, id, minutesAfter(5));

    expect(writes()).toBe(2);
  });

  it("is said once for a window read again: the window starts where the last finished run ended", async () => {
    const { test, id, writes } = await digestHost({ mode: "count" });
    test.operations.always("test.items", sourceResult([]));
    await ranAt(test, id, T0);
    const finished = (await test.store.getWorkflow(test.scope, id))
      ?.lastTriggerAt;
    expect(finished).toBe(T0);
    // What an earlier run of the window after T0 left behind.
    await leaveDoneReceipt(
      test,
      id,
      combinedItemId({
        kind: "count",
        nodeId: "digest",
        memberIds: [],
        windowStart: T0,
      }),
    );

    const again = await ranAt(test, id, minutesAfter(5));

    expect(writes()).toBe(1);
    expect(stepOf(again, "post").fields?.reused).toBe(1);
  });

  it("has an id that names its window when it has no members to name", () => {
    expect(listId("n", [], T0)).not.toBe(listId("n", [], minutesAfter(5)));
    expect(listId("n", [], T0)).toBe(listId("n", [], T0));
  });
});
