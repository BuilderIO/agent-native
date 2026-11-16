import { describe, expect, it } from "vitest";

import { receiptKey } from "../contract.js";
import { validateWorkflowGraph } from "../graph-validation.js";
import { buildGraph, type NodeSpec } from "../story-graphs.fixture.js";
import {
  EVERY_5M,
  eventsOf,
  endWith,
  minutesAfter,
  normalizedItem,
  providerQuery,
  ran,
  ranAt,
  sourceResult,
  stepOf,
  T0,
} from "../testing/engine-fixtures.js";
import { aiFailed, failure, ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";
import { buildTestCatalog } from "../testing/test-catalog.js";

const read = (onError?: "stop" | "route"): NodeSpec => [
  "look",
  "lookup",
  {
    operation: "test.read",
    args: { key: { mode: "path", path: "item.id" } },
    ...(onError === undefined ? {} : { onError }),
  },
];

const write = (onError?: "stop" | "route"): NodeSpec => [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "hello" } },
    ...(onError === undefined ? {} : { onError }),
  },
];

const judge = (onError?: "stop" | "route"): NodeSpec => [
  "judge",
  "ai",
  {
    instruction: "Is this fine?",
    mode: "perItem",
    batchSize: 5,
    result: { fine: { type: "boolean" } },
    ...(onError === undefined ? {} : { onError }),
  },
];

/** What the alert says: the real failure, read from the item that came down the error output. */
const alert: NodeSpec = [
  "alert",
  "action",
  {
    operation: "test.write",
    args: {
      text: {
        mode: "fixed",
        value:
          "{{ item.error.node }} failed ({{ item.error.code }}, outcome unknown: {{ item.error.outcomeUnknown }}): {{ item.error.message }}",
      },
    },
  },
];

/**
 * trigger -> source -> `failing` -> done, with `failing`'s error output going
 * to `alert` and then a `needsManual` End, when it has one.
 */
function routedGraph(failing: NodeSpec, routes = true) {
  const nodes: NodeSpec[] = [
    ["start", "trigger", EVERY_5M],
    ["src", "source", providerQuery()],
    failing,
    ["done", "end", endWith("done")],
    ...(routes
      ? ([alert, ["errored", "end", endWith("needsManual")]] as NodeSpec[])
      : []),
  ];
  return buildGraph({
    nodes,
    edges: [
      ["start", "out", "src"],
      ["src", "out", failing[0]],
      [failing[0], "out", "done"],
      ...(routes
        ? ([
            [failing[0], "error", "alert"],
            ["alert", "out", "errored"],
          ] as [string, string, string][])
        : []),
    ],
  });
}

async function setup(failing: NodeSpec, items = ["a"]) {
  const test = makeHost();
  const { id } = await seedWorkflow(test, routedGraph(failing));
  test.operations.always(
    "test.items",
    sourceResult(items.map((item) => normalizedItem(item))),
  );
  return { test, id };
}

async function trail(test: TestHost, workflowId: string, itemId: string) {
  return (await eventsOf(test, workflowId, itemId)).map(
    (event) => `${event.kind}:${event.outcome ?? event.code ?? ""}`,
  );
}

const sentText = (test: TestHost) =>
  test.operations
    .callsTo("test.write")
    .map((call) => call.fields.text as string);

describe("a step set to route errors", () => {
  it("sends a failed item out of its error port with the real code and message, and does not count it as failed", async () => {
    const { test, id } = await setup(read("route"));
    test.operations.always(
      "test.read",
      failure("lookup_failed", {
        message: "ticket 7 is gone",
        retryable: false,
      }),
    );
    test.operations.always(
      "test.write",
      ok({ ok: true }, { externalRef: "m1" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "look")).toMatchObject({
      status: "succeeded",
      ports: { out: { count: 0 }, error: { count: 1, itemIds: ["a"] } },
      fields: {
        routedErrors: 1,
        firstRoutedError: "lookup_failed: ticket 7 is gone",
      },
    });
    expect(stepOf(result, "look").error).toBeUndefined();
    expect(result.run.counts).toMatchObject({
      taken: 1,
      itemFailures: 0,
      errorRouted: 1,
      needsManual: 1,
    });
    expect(result.clean).toBe(true);
    expect(sentText(test)).toEqual([
      "look failed (lookup_failed, outcome unknown: false): ticket 7 is gone",
    ]);
    // The failure stays on the item's trail, and so does where it went.
    expect(await trail(test, id, "a")).toEqual([
      "taken:",
      "error:lookup_failed",
      "decision:",
      "effect:",
      "ended:needsManual",
    ]);
    expect(
      (await eventsOf(test, id, "a")).find(
        (event) => event.kind === "decision",
      ),
    ).toMatchObject({ nodeId: "look", port: "error" });
  });

  it("leaves the item on the main path when nothing failed", async () => {
    const { test, id } = await setup(read("route"));
    test.operations.always("test.read", ok({ value: 1 }));

    const result = await ran(test, id);

    expect(stepOf(result, "look").ports.out).toMatchObject({ count: 1 });
    expect(stepOf(result, "look").ports.error).toBeUndefined();
    expect(result.run.counts).toMatchObject({ done: 1, errorRouted: 0 });
    expect(test.operations.callsTo("test.write")).toEqual([]);
  });

  it("behaves exactly as before when onError is absent or stop", async () => {
    for (const onError of [undefined, "stop"] as const) {
      const test = makeHost();
      const { id } = await seedWorkflow(
        test,
        buildGraph({
          nodes: [
            ["start", "trigger", EVERY_5M],
            ["src", "source", providerQuery()],
            read(onError),
            ["done", "end", endWith("done")],
          ],
          edges: [
            ["start", "out", "src"],
            ["src", "out", "look"],
            ["look", "out", "done"],
          ],
        }),
      );
      test.operations.always("test.items", sourceResult([normalizedItem("a")]));
      test.operations.always(
        "test.read",
        failure("lookup_failed", { message: "gone", retryable: false }),
      );

      const result = await ran(test, id);

      expect(stepOf(result, "look")).toMatchObject({
        status: "failed",
        error: { code: "lookup_failed" },
      });
      expect(Object.keys(stepOf(result, "look").ports)).toEqual(["out"]);
      expect(result.run.counts).toMatchObject({
        itemFailures: 1,
        needsManual: 1,
        errorRouted: 0,
      });
      expect(await trail(test, id, "a")).toEqual([
        "taken:",
        "error:lookup_failed",
        "ended:needsManual",
      ]);
    }
  });

  it("retries a failure worth another try first, and routes it only when the attempts are spent", async () => {
    const { test, id } = await setup(read("route"));
    test.operations.always(
      "test.read",
      failure("provider_error", { message: "HTTP 503", retryable: true }),
    );
    test.operations.always(
      "test.write",
      ok({ ok: true }, { externalRef: "m1" }),
    );

    const first = await ranAt(test, id, T0);
    expect(first.run.counts).toMatchObject({ retryParked: 1, errorRouted: 0 });
    expect(stepOf(first, "look").status).toBe("failed");
    expect(sentText(test)).toEqual([]);

    const second = await ranAt(test, id, minutesAfter(6));
    expect(second.run.counts).toMatchObject({ retryParked: 1, errorRouted: 0 });
    expect(sentText(test)).toEqual([]);

    const third = await ranAt(test, id, minutesAfter(17));
    expect(third.run.counts).toMatchObject({ errorRouted: 1 });
    expect(stepOf(third, "look")).toMatchObject({
      status: "succeeded",
      ports: { error: { count: 1 } },
    });
    expect(sentText(test)).toEqual([
      "look failed (provider_error, outcome unknown: false): HTTP 503",
    ]);
  });

  it("routes at once in a dry run, which parks nothing, and the alert on the error path writes nothing", async () => {
    const { test, id } = await setup(read("route"));
    test.operations.always(
      "test.read",
      failure("provider_error", { message: "HTTP 503", retryable: true }),
    );

    const result = await ran(test, id, { mode: "dry" });

    expect(result.run.counts).toMatchObject({
      errorRouted: 1,
      itemFailures: 0,
    });
    expect(stepOf(result, "alert")).toMatchObject({
      fields: {
        wouldCallCount: 1,
        wouldCall: [
          {
            item: "a",
            fields: expect.stringContaining(
              "look failed (provider_error, outcome unknown: false): HTTP 503",
            ),
          },
        ],
      },
    });
    expect(test.operations.callsTo("test.write")).toEqual([]);
    expect(test.statuses.written).toEqual([]);
  });

  it("routes a write that may have happened, never repeats it, keeps its receipt open and still hands the item to a person", async () => {
    const { test, id } = await setup(write("route"));
    test.operations.script(
      "test.write",
      failure("provider_error", {
        message: "timed out",
        sideEffect: "maybe",
        retryable: true,
      }),
      ok({ ok: true }, { externalRef: "alert-1" }),
    );
    test.operations.always(
      "test.write",
      ok({ ok: true }, { externalRef: "x" }),
    );

    const first = await ran(test, id);

    expect(stepOf(first, "post")).toMatchObject({
      status: "needs_check",
      ports: { error: { count: 1 } },
    });
    expect(first.run.counts).toMatchObject({
      needsCheck: 1,
      itemFailures: 0,
      errorRouted: 1,
    });
    // Two calls: the write that came back unknown, and the alert about it.
    expect(sentText(test)).toHaveLength(2);
    expect(sentText(test)[1]).toContain("outcome unknown: true");
    expect(sentText(test)[1]).toContain("effect_needs_check");
    expect(sentText(test)[1]).toContain("timed out");
    expect(
      await test.store.getReceipt(
        test.scope,
        receiptKey({
          workflowId: id,
          itemId: "a",
          nodeId: "post",
          attempt: 0,
        }),
      ),
    ).toMatchObject({ status: "started" });
    const trailed = await trail(test, id, "a");
    expect(trailed.slice(0, 3)).toEqual([
      "taken:",
      "error:effect_needs_check",
      "ended:needsManual",
    ]);
    expect(trailed).toContain("decision:");

    // A person puts it back and the next tick finds the open receipt: the write is not sent again.
    test.statuses.rowStatus.set("a", "received");
    const second = await ran(test, id);

    expect(stepOf(second, "post").status).toBe("needs_check");
    expect(sentText(test)).toHaveLength(2);
  });

  it("routes an AI step's failure with its typed code", async () => {
    const { test, id } = await setup(judge("route"), ["a", "b"]);
    test.ai.always(aiFailed("credentials", "no model sign-in"));
    test.operations.always(
      "test.write",
      ok({ ok: true }, { externalRef: "m1" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "judge")).toMatchObject({
      status: "succeeded",
      ports: { out: { count: 0 }, error: { count: 2 } },
    });
    expect(result.run.counts).toMatchObject({
      errorRouted: 2,
      itemFailures: 0,
    });
    expect(sentText(test)).toEqual([
      "judge failed (credential_missing, outcome unknown: false): The AI turn failed (credentials): no model sign-in",
      "judge failed (credential_missing, outcome unknown: false): The AI turn failed (credentials): no model sign-in",
    ]);
  });
});

describe("saving a graph whose step routes errors", () => {
  const catalog = buildTestCatalog();

  it("refuses it while the error port leads nowhere, naming the port", () => {
    const graph = routedGraph(read("route"), false);

    const { ok: valid, issues } = validateWorkflowGraph(graph, catalog);

    expect(valid).toBe(false);
    expect(issues).toEqual([
      expect.objectContaining({
        code: "port_leads_nowhere",
        nodeId: "look",
        port: "error",
        detail: expect.stringContaining("error output"),
      }),
    ]);
  });

  it("accepts it once the error port is wired, and a stop step needs no error port", () => {
    expect(validateWorkflowGraph(routedGraph(read("route")), catalog)).toEqual({
      ok: true,
      issues: [],
    });
    expect(
      validateWorkflowGraph(routedGraph(read("stop"), false), catalog),
    ).toEqual({ ok: true, issues: [] });
  });
});
