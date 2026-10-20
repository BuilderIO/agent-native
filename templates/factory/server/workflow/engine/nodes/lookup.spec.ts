import { describe, expect, it } from "vitest";

import { MAX_STEP_OUTPUT_BYTES } from "../../items.js";
import {
  chain,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { failure, ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const read = (extra: Record<string, unknown> = {}) =>
  [
    "read",
    "lookup",
    {
      operation: "test.read",
      args: { key: { mode: "path", path: "item.title" } },
      ...extra,
    },
  ] as const;

const offered = (...ids: string[]) =>
  sourceResult(ids.map((id) => normalizedItem(id)));

async function setup(lookup = read()) {
  const test = makeHost();
  const workflow = await seedWorkflow(test, chain([[...lookup]]));
  return { test, id: workflow.id };
}

describe("a lookup", () => {
  it("attaches what it read under its own name, for later nodes to read", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.script("test.read", ok({ user: { id: "U1" } }));

    const result = await ran(test, id);

    expect(test.operations.callsTo("test.read")[0]).toMatchObject({
      fields: { key: "Item a" },
      credentialSlot: "test",
      mode: "live",
    });
    expect(stepOf(result, "read").ports.out).toEqual({
      count: 1,
      itemIds: ["a"],
    });
    const events = await eventsOf(test, id, "a");
    expect(events.find((event) => event.nodeId === "read")).toMatchObject({
      kind: "output",
      summary: 'read: {"user":{"id":"U1"}}',
    });
  });

  it("attaches under `into` when the lookup renames itself", async () => {
    const { test, id } = await setup(read({ into: "thread" }));
    test.operations.script("test.items", offered("a"));
    test.operations.script("test.read", ok({ n: 1 }));

    await ran(test, id);

    const events = await eventsOf(test, id, "a");
    expect(events.find((event) => event.nodeId === "read")?.summary).toMatch(
      /^thread:/,
    );
  });

  it("keeps a read that came back null: it found nothing, which is an answer", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.script("test.read", ok(null));

    const result = await ran(test, id);

    expect(stepOf(result, "read").ports.out.count).toBe(1);
    expect(stepOf(result, "read").status).toBe("succeeded");
  });

  it("does not read an answer with no output as an empty result", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.script("test.read", { ok: true, output: undefined });

    const result = await ran(test, id);

    expect(stepOf(result, "read")).toMatchObject({
      status: "failed",
      ports: { out: { count: 0 } },
      error: { code: "lookup_failed" },
    });
  });

  it("fails one item and carries on with the rest", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a", "b", "c"));
    test.operations.script(
      "test.read",
      ok({ n: 1 }),
      failure("provider_error", { message: "Slack said no" }),
      ok({ n: 3 }),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "read");
    expect(step.ports.out.itemIds).toEqual(["a", "c"]);
    expect(step.status).toBe("failed");
    expect(step.error).toEqual({
      code: "provider_error",
      message: "Slack said no",
    });
    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts.itemFailures).toBe(1);
    // The provider said no and a retry will not change that, so a person is told now.
    expect((await eventsOf(test, id, "b")).map((event) => event.kind)).toEqual([
      "taken",
      "error",
      "ended",
    ]);
    expect(test.statuses.statusOf("b")).toBe("needs_manual");
    expect(
      (await test.store.getItemState(test.scope, id, "b"))?.counters,
    ).toEqual({
      attempts: 1,
    });
    // The failed item's lease is given back.
    expect(
      (await test.store.getItemState(test.scope, id, "b"))?.leasedBy,
    ).toBeUndefined();
  });

  it("keeps the provider's own code for a failure that is not worth retrying", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.script(
      "test.read",
      failure("credential_missing", { message: "Connect Slack" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "read").error).toEqual({
      code: "credential_missing",
      message: "Connect Slack",
    });
    expect(test.operations.callsTo("test.read")).toHaveLength(1);
  });

  it("retries a read that failed with nothing done, through the clock", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.script(
      "test.read",
      failure("provider_error", { retryable: true }),
      ok({ n: 1 }),
    );

    const result = await ran(test, id);

    expect(test.clock.sleeps).toEqual([1000]);
    expect(stepOf(result, "read").status).toBe("succeeded");
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({});
  });

  it("hands an item to a person at once when the lookup fails in a way a retry cannot fix", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.always(
      "test.read",
      failure("provider_error", { message: "HTTP 404" }),
    );

    const first = await ran(test, id);

    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "a", status: "needs_manual" }),
    ]);
    expect(first.run.counts).toMatchObject({ itemFailures: 1, needsManual: 1 });
    expect(test.operations.callsTo("test.read")).toHaveLength(1);
  });

  it("retries a lookup that failed with nothing done, across ticks, and hands the item to a person after the third attempt", async () => {
    const { test, id } = await setup();
    test.operations.always("test.items", offered("a"));
    test.operations.always(
      "test.read",
      failure("provider_error", { message: "down", retryable: true }),
    );

    await ran(test, id);
    test.clock.advance(6 * 60_000);
    await ran(test, id);
    expect(test.statuses.written).toEqual([]);

    test.clock.advance(11 * 60_000);
    const third = await ran(test, id);

    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "a", status: "needs_manual" }),
    ]);
    expect(third.run.counts.needsManual).toBe(1);
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({
      attempts: 3,
    });
    const kinds = (await eventsOf(test, id, "a")).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "error")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "ended")).toHaveLength(1);
  });

  it("fails an item whose answer is too big to hold, not the whole step", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a", "b"));
    test.operations.script(
      "test.read",
      ok({ blob: "x".repeat(MAX_STEP_OUTPUT_BYTES) }),
      ok({ n: 2 }),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "read");
    expect(step.ports.out.itemIds).toEqual(["b"]);
    expect(step.error?.code).toBe("output_over_cap");
  });

  it("fails the step when the answers together are more than a step can hold", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a", "b", "c"));
    const big = ok({ blob: "x".repeat(30_000) });
    test.operations.script("test.read", big, big, big);

    const result = await ran(test, id);

    expect(stepOf(result, "read")).toMatchObject({
      status: "failed",
      error: { code: "output_over_cap" },
    });
    expect(stepOf(result, "done").status).toBe("skipped");
    expect(result.run).toMatchObject({
      status: "failed",
      error: { code: "output_over_cap" },
    });
  });

  it("fails an item whose arguments cannot be filled, naming the field", async () => {
    const { test, id } = await setup(
      read({ args: { key: { mode: "path", path: "item.nothing" } } }),
    );
    test.operations.script("test.items", offered("a"));

    const result = await ran(test, id);

    expect(stepOf(result, "read").error).toEqual({
      code: "expression_failed",
      message: 'args.key: "item.nothing" has no value here.',
    });
    expect(test.operations.callsTo("test.read")).toHaveLength(0);
  });

  it("runs for real in a dry run, with that mode on the call and the events", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", offered("a"));
    test.operations.script("test.read", ok({ n: 1 }));

    const result = await ran(test, id, { mode: "dry" });

    expect(test.operations.callsTo("test.read")[0].mode).toBe("dry");
    expect(stepOf(result, "read").ports.out.count).toBe(1);
    expect(
      (await eventsOf(test, id, "a")).every((event) => event.mode === "dry"),
    ).toBe(true);
    expect(test.statuses.written).toEqual([]);
    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
  });
});
