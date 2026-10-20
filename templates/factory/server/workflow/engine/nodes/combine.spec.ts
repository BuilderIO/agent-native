import { describe, expect, it } from "vitest";

import type { NormalizedItem } from "../../items.js";
import {
  chain,
  endWith,
  eventsOf,
  last,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
  T0,
} from "../../testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";
import { stableHash } from "../bounds.js";
import { combinedItemId } from "./combine.js";

const commit = (id: string, extras: Record<string, unknown> = {}) =>
  normalizedItem(id, {
    kind: "commit",
    author: "ada",
    url: `https://example.test/${id}`,
    text: "body text that stays out of a list",
    payload: { huge: "payload" },
    extras,
  });

async function runCombine(
  settings: Record<string, unknown>,
  list: readonly NormalizedItem[],
  end = endWith("done"),
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain([["combine", "combine", settings]], { end }),
  );
  test.operations.script("test.items", sourceResult(list));
  const result = await ran(test, id);
  return { test, id, result };
}

describe("a combine into a list", () => {
  it("makes one item holding a short account of each member and a count", async () => {
    const { test, id, result } = await runCombine({ mode: "list" }, [
      commit("c1"),
      commit("c2"),
    ]);

    const step = stepOf(result, "combine");
    expect(step.ports.out.count).toBe(1);
    const [outId] = step.ports.out.itemIds;
    expect(outId).toBe(
      combinedItemId({
        kind: "list",
        nodeId: "combine",
        memberIds: ["c1", "c2"],
        windowStart: T0,
      }),
    );
    const events = await eventsOf(test, id, outId);
    expect(events[0].summary).toBe("combined 2 items");
    expect(
      (await eventsOf(test, id, "c1")).find(
        (event) => event.nodeId === "combine",
      ),
    ).toMatchObject({
      kind: "output",
      summary: `combined into ${outId}`,
    });
  });

  it("leaves bodies and payloads out of the list so a hundred members still fit", async () => {
    const list = Array.from({ length: 40 }, (_, index) => commit(`c${index}`));
    const { result } = await runCombine({ mode: "list" }, list);

    expect(stepOf(result, "combine").status).toBe("succeeded");
    expect(stepOf(result, "combine").ports.out.count).toBe(1);
  });

  it("collects one field of each member when asked", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        ["combine", "combine", { mode: "list", field: "item.title" }],
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: { mode: "path", path: "item.items[1]" },
            },
          },
        ],
      ]),
    );
    test.operations.script(
      "test.items",
      sourceResult([commit("c1"), commit("c2")]),
    );
    test.operations.script("test.write", {
      ok: true,
      output: null,
      externalRef: "r",
    });

    await ran(test, id);

    expect(test.operations.callsTo("test.write")[0].fields.text).toBe(
      "Item c2",
    );
  });

  it("is still one item, with a count of zero, over nothing, so 'nothing happened' can be said", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        ["digest", "combine", { mode: "list" }],
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: { mode: "fixed", value: "{{ item.count }} commits" },
            },
          },
        ],
      ]),
    );
    test.operations.script("test.items", sourceResult([]));
    test.operations.script("test.write", {
      ok: true,
      output: null,
      externalRef: "r",
    });

    const result = await ran(test, id);

    expect(stepOf(result, "digest").ports.out.count).toBe(1);
    expect(test.operations.callsTo("test.write")[0].fields.text).toBe(
      "0 commits",
    );
  });

  it("fails the whole step when a member's field has no value, rather than listing the rest as if they were all", async () => {
    const { test, id, result } = await runCombine(
      { mode: "list", field: "item.extras.sha" },
      [commit("c1", { sha: "aaa" }), commit("c2")],
    );

    const step = stepOf(result, "combine");
    expect(step.status).toBe("failed");
    expect(step.error?.code).toBe("expression_failed");
    expect(step.ports).toEqual({});
    expect(result.run.status).toBe("failed");
    expect(
      (await eventsOf(test, id, "c2")).find((event) => event.kind === "error"),
    ).toMatchObject({ nodeId: "combine", code: "expression_failed" });
  });

  it("stands for the inbox items it combined, so ending it ends them", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([["combine", "combine", { mode: "count" }]], {
        source: {
          source: "provider-query",
          operation: "test.items",
          args: {},
          memory: "inbox",
          maxItems: 50,
        },
      }),
    );
    test.operations.script(
      "test.items",
      sourceResult([commit("c1"), commit("c2")]),
    );

    await ran(test, id);

    expect(
      test.statuses.written.map((entry) => [entry.itemId, entry.status]),
    ).toEqual([
      ["c1", "resolved"],
      ["c2", "resolved"],
    ]);
    expect(last(await eventsOf(test, id, "c1"))).toMatchObject({
      kind: "ended",
      summary: expect.stringContaining(
        `through ${combinedItemId({
          kind: "count",
          nodeId: "combine",
          memberIds: ["c1", "c2"],
          windowStart: T0,
        })}`,
      ),
    });
  });

  it("does not write a status for members that are not inbox rows", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([["combine", "combine", { mode: "count" }]], {
        source: {
          source: "provider-query",
          operation: "test.items",
          args: {},
          memory: "none",
          maxItems: 50,
        },
      }),
    );
    test.operations.script("test.items", sourceResult([commit("c1")]));

    await ran(test, id);

    expect(test.statuses.written).toEqual([]);
  });
});

describe("a combine into a count", () => {
  it("holds only the count", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        ["total", "combine", { mode: "count" }],
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "fixed", value: "n={{ item.count }}" } },
          },
        ],
      ]),
    );
    test.operations.script(
      "test.items",
      sourceResult([commit("a"), commit("b"), commit("c")]),
    );
    test.operations.script("test.write", {
      ok: true,
      output: null,
      externalRef: "r",
    });

    await ran(test, id);

    expect(test.operations.callsTo("test.write")[0].fields.text).toBe("n=3");
  });
});

describe("a combine by key", () => {
  const byTask = { mode: "groupBy", key: "item.extras.task" };

  it("makes one item per key, in first-seen order, that reads like its first member and lists them all", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        ["byTask", "combine", byTask],
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value:
                  "{{ item.key }}/{{ item.count }}/{{ item.title }}/{{ item.reports[1].id }}",
              },
            },
          },
        ],
      ]),
    );
    test.operations.script(
      "test.items",
      sourceResult([
        commit("a", { task: "t1" }),
        commit("b", { task: "t2" }),
        commit("c", { task: "t1" }),
      ]),
    );
    test.operations.always("test.write", {
      ok: true,
      output: null,
      externalRef: "r",
    });

    const result = await ran(test, id);

    expect(stepOf(result, "byTask").ports.out.count).toBe(2);
    // t2 has one report, so only t1's text can read reports[1]; t2 fails that item.
    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["t1/2/Item a/c"]);
    expect(stepOf(result, "say").error?.code).toBe("expression_failed");
  });

  it("gives a group the same id on every tick, so what is counted on it stays counted", async () => {
    const first = await runCombine(byTask, [commit("a", { task: "t1" })]);
    const second = await runCombine(byTask, [commit("z", { task: "t1" })]);

    expect(stepOf(first.result, "combine").ports.out.itemIds).toEqual([
      `group:combine:${stableHash("t1")}`,
    ]);
    expect(stepOf(second.result, "combine").ports.out.itemIds).toEqual(
      stepOf(first.result, "combine").ports.out.itemIds,
    );
  });

  it("makes nothing from nothing", async () => {
    const { result } = await runCombine(byTask, []);

    expect(stepOf(result, "combine").ports.out.count).toBe(0);
  });

  it("fails an item with no key, or a key that is a list, and groups the rest", async () => {
    const { result } = await runCombine(byTask, [
      commit("a", { task: "t1" }),
      commit("b"),
      commit("c", { task: ["x"] }),
    ]);

    const step = stepOf(result, "combine");
    expect(step.ports.out.count).toBe(1);
    expect(result.run.counts.itemFailures).toBe(2);
  });
});

describe("a combine that summarizes", () => {
  const spend = (id: string, day: string, service: string, cost: unknown) =>
    normalizedItem(id, {
      occurredAt: `2026-10-${day}T00:00:00.000Z`,
      extras: { service, cost },
    });
  const settings = (extra: Record<string, unknown> = {}) => ({
    mode: "summarize",
    summarize: {
      group: "item.extras.service",
      value: "item.extras.cost",
      agg: "sum",
      ...extra,
    },
  });

  async function summarize(
    summarySettings: Record<string, unknown>,
    list: readonly NormalizedItem[],
  ) {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        ["summary", "combine", summarySettings],
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value: "{{ item.key }}={{ item.total }}",
              },
            },
          },
        ],
      ]),
    );
    test.operations.script("test.items", sourceResult(list));
    test.operations.always("test.write", {
      ok: true,
      output: null,
      externalRef: "r",
    });
    const result = await ran(test, id);
    return { test, id, result };
  }

  it("totals each group", async () => {
    const { test } = await summarize(settings(), [
      spend("a", "01", "compute", 10),
      spend("b", "02", "compute", 5),
      spend("c", "01", "storage", 2),
    ]);

    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["compute=15", "storage=2"]);
  });

  it("averages and counts", async () => {
    const avg = await summarize(settings({ agg: "avg" }), [
      spend("a", "01", "compute", 10),
      spend("b", "02", "compute", 20),
    ]);
    expect(avg.test.operations.callsTo("test.write")[0].fields.text).toContain(
      "15",
    );

    const count = await summarize(settings({ agg: "count" }), [
      spend("a", "01", "compute", "not read for a count"),
      spend("b", "02", "compute", 20),
    ]);
    expect(
      count.test.operations.callsTo("test.write")[0].fields.text,
    ).toContain("2");
  });

  it("compares the latest day with the trailing average and exposes the increase", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [
          "summary",
          "combine",
          settings({
            baseline: { window: 7, bucket: "day" },
            compare: "latestVsAverage",
          }),
        ],
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value:
                  "{{ item.latestBucket }} {{ item.latest }} {{ item.baselineAverage }} {{ item.baselineBuckets }} {{ item.increaseAmount }} {{ item.increasePercent }}",
              },
            },
          },
        ],
      ]),
    );
    test.operations.script(
      "test.items",
      sourceResult([
        spend("a", "15", "compute", 100),
        spend("b", "16", "compute", 100),
        spend("c", "17", "compute", 100),
        spend("d", "18", "compute", 200),
        spend("e", "18", "compute", 100),
      ]),
    );
    test.operations.script("test.write", {
      ok: true,
      output: null,
      externalRef: "r",
    });

    await ran(test, id);

    // Latest day sums to 300 against a three-day average of 100: +200, +200%.
    expect(test.operations.callsTo("test.write")[0].fields.text).toBe(
      "2026-10-18 300 100 3 200 200",
    );
  });

  /** What a summarized group says about its baseline, read from the item's recorded output. */
  async function baselineOf(
    test: Awaited<ReturnType<typeof summarize>>["test"],
    id: string,
    result: Awaited<ReturnType<typeof summarize>>["result"],
  ) {
    const step = stepOf(result, "summary");
    expect(step.status).toBe("succeeded");
    const [itemId] = step.ports.out.itemIds;
    const [event] = await eventsOf(test, id, itemId);
    return JSON.parse(event.summary.slice(event.summary.indexOf("{")));
  }

  it("says the baseline is missing, and compares nothing, for a group with nothing earlier", async () => {
    const { test, id, result } = await summarize(
      settings({
        baseline: { window: 7, bucket: "day" },
        compare: "latestVsAverage",
      }),
      [spend("a", "18", "brand-new", 100)],
    );

    const data = await baselineOf(test, id, result);
    expect(data).toMatchObject({
      key: "brand-new",
      baselineMissing: true,
      baselineMissingReason: expect.stringContaining("no earlier bucket"),
    });
    expect(data).not.toHaveProperty("increasePercent");
    expect(data).not.toHaveProperty("baselineAverage");
  });

  it("says the baseline is missing for a group whose baseline is zero, since a percent cannot be said", async () => {
    const { test, id, result } = await summarize(
      settings({
        baseline: { window: 7, bucket: "day" },
        compare: "latestVsAverage",
      }),
      [spend("a", "17", "idle", 0), spend("b", "18", "idle", 50)],
    );

    expect(await baselineOf(test, id, result)).toMatchObject({
      baselineMissing: true,
      baselineMissingReason: expect.stringContaining("zero"),
    });
  });

  it("fails the step when a value is not a number, instead of totalling the groups it could read", async () => {
    const { result } = await summarize(settings(), [
      spend("a", "01", "compute", "ten"),
      spend("b", "01", "storage", 3),
    ]);

    const step = stepOf(result, "summary");
    expect(step.status).toBe("failed");
    expect(step.ports).toEqual({});
    expect(step.error?.code).toBe("expression_failed");
    expect(result.run.status).toBe("failed");
  });
});
