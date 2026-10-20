import { describe, expect, it } from "vitest";

import { MAX_ITEM_CONTEXT_BYTES, jsonByteLength } from "../items.js";
import type { NodeSpec } from "../story-graphs.fixture.js";
import {
  chain,
  eventsOf,
  minutesAfter,
  normalizedItem,
  ran,
  sourceResult,
} from "../testing/engine-fixtures.js";
import { aiFailed, aiPerItem, ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";
import { combinedItemId } from "./nodes/combine.js";

const window = {
  source: "window",
  operation: "test.window",
  args: {},
  maxItems: 100,
};

const commits = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    normalizedItem(`c${index}`, {
      title: `commit ${index} ${"x".repeat(150)}`,
      url: `https://example.test/commit/${index}`,
    }),
  );

const lookup = [
  "look",
  "lookup",
  { operation: "test.read", args: { key: { mode: "fixed", value: "k" } } },
] as const;

const writtenByAi = [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "ai", instruction: "Write the digest" } },
  },
] as const;

const writtenAgain = [
  "again",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "ai", instruction: "Write it again" } },
  },
] as const;

/** A digest of sixty commits is more than a parked row can hold, once a node after it writes with the whole item in view. */
async function bigDigest(
  tail: NodeSpec[] = [[...writtenByAi]],
  source: Record<string, unknown> = window,
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain([["digest", "combine", { mode: "list" }], [...lookup], ...tail], {
      source,
    }),
  );
  test.operations.always("test.read", ok({ v: 1 }));
  test.operations.always("test.write", ok({}, { externalRef: "m" }));
  test.ai.always(aiPerItem(() => ({ text: "digest text" })));
  return { test, id };
}

const lastTrigger = async (test: TestHost, id: string) =>
  (await test.store.getWorkflow(test.scope, id))?.lastTriggerAt ?? null;

/** The soft deadline comes right after the lookup of each run, before the post; call the result before a run to arm it. */
function stopAfterLookup(test: TestHost): () => void {
  let from = 0;
  test.stopWhen(
    () =>
      test.operations.callsTo("test.read").length > from &&
      test.operations.callsTo("test.write").length === 0,
  );
  return () => {
    from = test.operations.callsTo("test.read").length;
  };
}

const digestId = (count: number) =>
  combinedItemId({
    kind: "list",
    nodeId: "digest",
    memberIds: commits(count).map((item) => item.id),
    windowStart: minutesAfter(0),
  });

describe("a digest too big to be set aside", () => {
  it("is not the same as a digest that was sent: the window stays, and the next run builds it again", async () => {
    const { test, id } = await bigDigest();
    expect(jsonByteLength({ items: commits(60) })).toBeGreaterThan(
      MAX_ITEM_CONTEXT_BYTES,
    );
    test.operations.always("test.window", sourceResult(commits(60)));
    const arm = stopAfterLookup(test);
    arm();

    const first = await ran(test, id);

    expect(first.run).toMatchObject({
      status: "paused",
      error: { code: "context_truncated" },
      counts: { heldBack: 1, needsManual: 0, setAside: 0 },
    });
    expect(await lastTrigger(test, id)).toBeNull();
    expect(test.operations.callsTo("test.write")).toHaveLength(0);

    test.stopWhen(() => false);
    test.clock.advance(6 * 60_000);
    const second = await ran(test, id);

    expect(second.run).toMatchObject({
      status: "succeeded",
      counts: { done: 1, needsManual: 0, heldBack: 0 },
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(await lastTrigger(test, id)).not.toBeNull();
  });

  it("is built again when an AI-written post timed out, rather than being given up on", async () => {
    const { test, id } = await bigDigest();
    test.operations.always("test.window", sourceResult(commits(60)));
    test.ai.respond(aiFailed("timeout"));

    const first = await ran(test, id);

    expect(first.run).toMatchObject({
      status: "paused",
      counts: { heldBack: 1, needsManual: 0, itemFailures: 1 },
    });
    expect(await lastTrigger(test, id)).toBeNull();

    test.clock.advance(6 * 60_000);
    const second = await ran(test, id);

    expect(second.run).toMatchObject({
      status: "succeeded",
      counts: { done: 1, needsManual: 0 },
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(await lastTrigger(test, id)).not.toBeNull();
  });

  it("does not send again what the first run had already sent before it stopped", async () => {
    const { test, id } = await bigDigest([[...writtenByAi], [...writtenAgain]]);
    test.operations.always("test.window", sourceResult(commits(60)));
    // The deadline comes after the first post, before the second.
    test.stopWhen(() => test.operations.callsTo("test.write").length === 1);

    const first = await ran(test, id);
    test.stopWhen(() => false);
    const second = await ran(test, id);

    expect(first.run).toMatchObject({
      status: "paused",
      counts: { heldBack: 1 },
    });
    expect(second.run.status).toBe("succeeded");
    // One post each, though the first was reached in both runs.
    expect(test.operations.callsTo("test.write")).toHaveLength(2);
  });

  it("gives up after three tries, hands the digest to a person, and moves the window on", async () => {
    const { test, id } = await bigDigest();
    test.operations.always("test.window", sourceResult(commits(60)));
    const arm = stopAfterLookup(test);

    const runs = [];
    for (let tick = 0; tick < 3; tick += 1) {
      arm();
      runs.push(await ran(test, id));
      test.clock.advance(6 * 60_000);
    }

    expect(runs.map((run) => run.run.counts.heldBack)).toEqual([1, 1, 0]);
    expect(runs.map((run) => run.run.counts.needsManual)).toEqual([0, 0, 1]);
    expect(await lastTrigger(test, id)).not.toBeNull();
    const trail = await eventsOf(test, id, digestId(60));
    expect(trail[trail.length - 1]).toMatchObject({
      kind: "ended",
      outcome: "needsManual",
    });
    expect(trail[trail.length - 1].summary).toContain("window");
  });

  it("gives up after the same number of tries when what keeps stopping it is a failing write", async () => {
    const { test, id } = await bigDigest();
    test.operations.always("test.window", sourceResult(commits(60)));
    test.ai.always(aiFailed("timeout"));

    const runs = [];
    for (let tick = 0; tick < 3; tick += 1) {
      runs.push(await ran(test, id));
      test.clock.advance(6 * 60_000);
    }

    expect(runs.map((run) => run.run.counts.needsManual)).toEqual([0, 0, 1]);
    expect(await lastTrigger(test, id)).not.toBeNull();
  });

  it("leaves the rows of an inbox source open and offered again, never ended on the way", async () => {
    const { test, id } = await bigDigest([[...writtenByAi]], {
      source: "provider-query",
      operation: "test.items",
      args: {},
      memory: "inbox",
      maxItems: 50,
    });
    test.operations.always("test.items", sourceResult(commits(50)));
    stopAfterLookup(test)();

    const first = await ran(test, id);

    expect(first.run.counts).toMatchObject({
      taken: 50,
      heldBack: 1,
      needsManual: 0,
    });
    expect(test.statuses.written).toEqual([]);

    test.stopWhen(() => false);
    const second = await ran(test, id);

    expect(second.run.counts).toMatchObject({ taken: 50, done: 1 });
    expect(test.statuses.written).toHaveLength(50);
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
  });
});

describe("a single item too big to be set aside", () => {
  it("is still handed to a person when it is an inbox row, which carries the fact on its status", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [...lookup],
          [
            "assess",
            "ai",
            {
              instruction: "Summarize this call",
              mode: "perItem",
              batchSize: 1,
              result: { summary: { type: "string" } },
            },
          ],
        ],
        { settings: { modelCallCap: 1 } },
      ),
    );
    test.operations.script("test.items", sourceResult(commits(2)));
    test.operations.always(
      "test.read",
      ok({ transcript: "x".repeat(MAX_ITEM_CONTEXT_BYTES + 1000) }),
    );
    test.ai.always(aiPerItem(() => ({ summary: "s" })));

    const first = await ran(test, id);

    expect(first.run.counts).toMatchObject({
      needsManual: 1,
      itemFailures: 1,
      heldBack: 0,
    });
    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "c1", status: "needs_manual" }),
      expect.objectContaining({ itemId: "c0", status: "resolved" }),
    ]);
  });
});
