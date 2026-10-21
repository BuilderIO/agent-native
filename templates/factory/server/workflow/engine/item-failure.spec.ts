import { describe, expect, it } from "vitest";

import {
  chain,
  eventsOf,
  last,
  minutesAfter,
  normalizedItem,
  ran,
  ranAt,
  sourceResult,
  stepOf,
  T0,
} from "../testing/engine-fixtures.js";
import { failure } from "../testing/fakes.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";
import { MAX_ITEM_ATTEMPTS } from "./constants.js";

const write = [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "hi" } },
  },
] as const;

const windowSource = {
  source: "window",
  operation: "test.window",
  args: {},
  maxItems: 50,
};

/** What an item's trail says happened to it, as `kind:outcome-or-code`. */
async function trail(test: TestHost, workflowId: string, itemId: string) {
  return (await eventsOf(test, workflowId, itemId)).map(
    (event) => `${event.kind}:${event.outcome ?? event.code ?? ""}`,
  );
}

describe("an item that fails in a way no retry can fix", () => {
  it("is handed to a person at once behind a cursor source, while the cursor moves on", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...write]]));
    test.operations.script(
      "test.items",
      sourceResult([normalizedItem("lead-1")], { cursor: "c1" }),
    );
    test.operations.always("test.items", sourceResult([]));
    test.operations.always(
      "test.write",
      failure("provider_error", { message: "HTTP 400", retryable: false }),
    );

    const first = await ran(test, id);
    for (let tick = 0; tick < 3; tick += 1) await ran(test, id);

    // The source will never offer it again, so this is the only chance.
    expect(
      await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "src",
      }),
    ).toMatchObject({ value: "c1" });
    expect(await trail(test, id, "lead-1")).toEqual([
      "taken:",
      "error:provider_error",
      "ended:needsManual",
    ]);
    expect(test.statuses.written).toMatchObject([
      { itemId: "lead-1", status: "needs_manual" },
    ]);
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(first.run.status).toBe("succeeded");
    expect(first.run.counts).toMatchObject({
      taken: 1,
      itemFailures: 1,
      needsManual: 1,
      retryParked: 0,
    });
    expect(
      (await test.store.getItemState(test.scope, id, "lead-1"))?.wake,
    ).toBeUndefined();
  });

  it("is handed to a person at once behind a window source, where no row holds its status", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([[...write]], { source: windowSource }),
    );
    test.operations.script(
      "test.window",
      sourceResult([normalizedItem("call-1")]),
    );
    test.operations.always("test.window", sourceResult([]));
    test.operations.always(
      "test.write",
      failure("provider_error", { message: "HTTP 422", retryable: false }),
    );

    const first = await ran(test, id);
    await ran(test, id);

    expect(await trail(test, id, "call-1")).toEqual([
      "taken:",
      "error:provider_error",
      "ended:needsManual",
    ]);
    expect(first.run.counts).toMatchObject({ itemFailures: 1, needsManual: 1 });
    expect(stepOf(first, "post").status).toBe("failed");
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
  });

  it("says why on the item's event, not only in its summary", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...write]]));
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.always(
      "test.write",
      failure("credential_missing", { message: "no token", retryable: false }),
    );

    await ran(test, id);

    const events = await eventsOf(test, id, "a");
    expect(events.find((event) => event.kind === "error")).toMatchObject({
      code: "credential_missing",
      nodeId: "post",
    });
    expect(last(events)).toMatchObject({
      kind: "ended",
      outcome: "needsManual",
      nodeId: "post",
    });
    expect(test.statuses.written[0].reason).toContain("no token");
  });
});

describe("no failed item is invisible after the run", () => {
  const cases = [
    {
      name: "a failure that will not succeed is handed to a person",
      result: () => failure("provider_error", { retryable: false }),
      expected: ["taken:", "error:provider_error", "ended:needsManual"],
    },
    {
      name: "a failure worth another try is parked for a retry",
      result: () => failure("provider_error", { retryable: true }),
      expected: ["taken:", "error:provider_error", "parked:"],
    },
    {
      name: "a write that may have happened is handed to a person to check",
      result: () =>
        failure("provider_error", { retryable: false, sideEffect: "maybe" }),
      expected: ["taken:", "error:effect_needs_check", "ended:needsManual"],
    },
  ] as const;

  for (const { name, result, expected } of cases) {
    it(`${name}, even when its source never offers it again`, async () => {
      const test = makeHost();
      const { id } = await seedWorkflow(
        test,
        chain([[...write]], { source: windowSource }),
      );
      test.operations.script(
        "test.window",
        sourceResult([normalizedItem("a")]),
      );
      test.operations.always("test.window", sourceResult([]));
      test.operations.always("test.write", result());

      await ran(test, id);

      expect((await trail(test, id, "a")).slice(0, expected.length)).toEqual([
        ...expected,
      ]);
      const state = await test.store.getItemState(test.scope, id, "a");
      const ended = (await trail(test, id, "a")).includes("ended:needsManual");
      expect(ended || state?.wake?.wait === "retry").toBe(true);
    });
  }

  it("counts a failed hand-off's item as out of attempts, so Items still shows it", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...write]]));
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.always("test.write", failure("provider_error"));
    test.statuses.refuseNext("the inbox is down", false);

    const first = await ran(test, id);

    const events = await eventsOf(test, id, "a");
    expect(events.map((event) => event.kind)).toEqual([
      "taken",
      "error",
      "error",
    ]);
    expect(last(events).summary).toContain("the inbox is down");
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters.attempts,
    ).toBe(MAX_ITEM_ATTEMPTS);
    expect(first.run.counts.itemFailures).toBe(1);
  });
});

describe("an item that fails in a way a later try may fix", () => {
  it("is still parked for a retry and does not end", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...write]]));
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.always(
      "test.write",
      failure("provider_error", { retryable: true }),
    );

    const first = await ran(test, id);

    const state = await test.store.getItemState(test.scope, id, "a");
    expect(state?.wake).toMatchObject({ wait: "retry" });
    // Five minutes from when it failed, which is after the call's own short retries.
    const wait = Date.parse(state?.wake?.dueAt ?? "") - Date.parse(T0);
    expect(wait).toBeGreaterThanOrEqual(5 * 60_000);
    expect(wait).toBeLessThan(6 * 60_000);
    expect(first.run.counts).toMatchObject({
      itemFailures: 1,
      retryParked: 1,
      needsManual: 0,
    });
  });

  it("goes to a person on its third failure", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...write]]));
    test.operations.always("test.items", sourceResult([normalizedItem("a")]));
    test.operations.always(
      "test.write",
      failure("provider_error", { retryable: true }),
    );

    await ranAt(test, id, T0);
    await ranAt(test, id, minutesAfter(6));
    await ranAt(test, id, minutesAfter(17));

    expect(
      (await trail(test, id, "a")).filter(
        (entry) => entry === "ended:needsManual",
      ),
    ).toHaveLength(1);
  });
});
