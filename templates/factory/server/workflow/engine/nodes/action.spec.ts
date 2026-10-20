import { describe, expect, it } from "vitest";

import { receiptKey } from "../../contract.js";
import { MAX_STEP_OUTPUT_BYTES } from "../../items.js";
import {
  chain,
  endWith,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { aiPerItem, failure, ok } from "../../testing/fakes.js";
import {
  makeHost,
  seedWorkflow,
  type TestHost,
} from "../../testing/make-host.js";

const post = (args: Record<string, unknown> = {}) =>
  [
    "post",
    "action",
    {
      operation: "test.write",
      args: {
        text: { mode: "fixed", value: "Hello {{ item.title }}" },
        ...args,
      },
    },
  ] as const;

const posted = (ref = "msg-1") =>
  ok({ ok: true }, { externalRef: ref, url: `https://example.test/${ref}` });

async function setup(options: { end?: Record<string, unknown> } = {}) {
  const test = makeHost();
  const workflow = await seedWorkflow(
    test,
    chain([[...post()]], { end: options.end }),
  );
  test.operations.always("test.items", sourceResult([normalizedItem("a")]));
  const key = (attempt: number) =>
    receiptKey({
      workflowId: workflow.id,
      itemId: "a",
      nodeId: "post",
      attempt,
    });
  const receipt = (attempt: number) =>
    test.store.getReceipt(test.scope, key(attempt));
  return { test, id: workflow.id, key, receipt };
}

describe("a write in a live run", () => {
  it("opens a receipt before the call, closes it with the reference, and carries both forward", async () => {
    const { test, id, key, receipt } = await setup();
    let startedDuringCall: string | undefined;
    test.operations.script("test.write", async (request) => {
      // The receipt exists, still started, while the call is in flight.
      expect(request.receiptKey).toBe(key(0));
      startedDuringCall = (await receipt(0))?.status;
      return posted("msg-1");
    });

    const result = await ran(test, id);

    expect(startedDuringCall).toBe("started");
    expect(await receipt(0)).toMatchObject({
      status: "done",
      externalRef: "msg-1",
      url: "https://example.test/msg-1",
    });
    const call = test.operations.callsTo("test.write")[0];
    expect(call).toMatchObject({
      fields: { text: "Hello Item a" },
      credentialSlot: "test",
      mode: "live",
    });
    const step = stepOf(result, "post");
    expect(step.status).toBe("succeeded");
    expect(step.receiptKeys).toEqual([key(0)]);
    const effect = (await eventsOf(test, id, "a")).find(
      (event) => event.kind === "effect",
    );
    expect(effect).toMatchObject({
      nodeId: "post",
      receiptKey: key(0),
      summary: "called test.write -> msg-1 (https://example.test/msg-1)",
    });
  });

  it("hands later nodes the receipt's reference and link at the top of its result", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [...post()],
        [
          "echo",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value:
                  "{{ nodes.post.externalRef }} {{ nodes.post.url }} {{ nodes.post.ok }}",
              },
            },
          },
        ],
      ]),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.script("test.write", posted("msg-1"), posted("msg-2"));

    await ran(test, id);

    expect(test.operations.callsTo("test.write")[1].fields.text).toBe(
      "msg-1 https://example.test/msg-1 true",
    );
  });

  it("does not call again when a paused tick is picked up: the item goes on from the node it was waiting at", async () => {
    const { test, id, receipt } = await setup();
    test.operations.script("test.write", async () => {
      // The deadline passes right after the write, before the item can end.
      test.stopWhen(() => true);
      return posted("msg-1");
    });

    const first = await ran(test, id);
    expect(first.run.status).toBe("paused");
    expect(await test.store.getItemState(test.scope, id, "a")).toMatchObject({
      parkedAtNode: "done",
      wake: { wait: "retry" },
    });
    test.stopWhen(() => false);
    const second = await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(second.run.status).toBe("succeeded");
    expect(second.run.counts).toMatchObject({ continued: 1, done: 1 });
    // The write node ran over nothing: the item went straight to the End.
    expect(stepOf(second, "post").fields).toMatchObject({ in: 0 });
    expect(await receipt(0)).toMatchObject({ status: "done" });
    const effects = (await eventsOf(test, id, "a")).filter(
      (event) => event.kind === "effect",
    );
    expect(effects.map((event) => event.summary)).toEqual([
      "called test.write -> msg-1 (https://example.test/msg-1)",
    ]);
    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "a", status: "resolved" }),
    ]);
  });

  it("writes again on the next visit of an item that was released, under a new key", async () => {
    const { test, id, key } = await setup({ end: endWith("released") });
    test.operations.script("test.write", posted("msg-1"), posted("msg-2"));

    await ran(test, id);
    await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(2);
    const second = receiptKey({
      workflowId: id,
      itemId: "a",
      nodeId: "post",
      attempt: 1000,
    });
    expect((await test.store.getReceipt(test.scope, key(0)))?.externalRef).toBe(
      "msg-1",
    );
    expect((await test.store.getReceipt(test.scope, second))?.externalRef).toBe(
      "msg-2",
    );
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({
      rounds: 2,
    });
  });

  it("stops for a person, and does not call, when an earlier attempt started and never closed", async () => {
    const { test, id, key, receipt } = await setup();
    await test.store.putReceipt(test.scope, id, {
      key: key(0),
      status: "started",
      at: test.clock.now().toISOString(),
    });

    const result = await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(0);
    const step = stepOf(result, "post");
    expect(step).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
      receiptKeys: [key(0)],
    });
    expect(step.ports.out.count).toBe(0);
    expect(await receipt(0)).toMatchObject({ status: "started" });
    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "a", status: "needs_manual" }),
    ]);
    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts).toMatchObject({ needsCheck: 1, needsManual: 1 });
    expect(result.clean).toBe(false);
  });

  it("stops for a person without calling when it finds a started receipt", async () => {
    const { test, id, key } = await setup();
    await test.store.putReceipt(test.scope, id, {
      key: key(0),
      status: "started",
      at: test.clock.now().toISOString(),
    });

    const result = await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(0);
    expect(stepOf(result, "post")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
      receiptKeys: [key(0)],
    });
    expect(result.run.status).toBe("succeeded");
    expect(result.run.counts).toMatchObject({ needsCheck: 1, needsManual: 1 });
  });

  it("fails the run with the store's own error when another attempt wrote a receipt key first", async () => {
    const { test, id, key } = await setup();
    await test.store.putReceipt(test.scope, id, {
      key: key(0),
      status: "started",
      at: test.clock.now().toISOString(),
    });
    // The read that comes first saw nothing: the other attempt wrote after it.
    const racing: TestHost = {
      ...test,
      host: {
        ...test.host,
        store: { ...test.store, getReceipt: async () => null },
      },
    };

    await expect(ran(racing, id)).rejects.toMatchObject({
      code: "receipt_conflict",
    });

    const [run] = (await test.store.listRuns(test.scope, { workflowId: id }))
      .items;
    expect(run).toMatchObject({
      status: "failed",
      error: { code: "engine_error" },
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(0);
  });

  it("treats a failure that may have had an effect as needing a check, and never retries it", async () => {
    const { test, id, receipt } = await setup();
    test.operations.script(
      "test.write",
      failure("provider_error", {
        message: "timed out",
        sideEffect: "maybe",
        retryable: true,
      }),
    );

    const first = await ran(test, id);
    // The item went to a person; a person who puts it back in the queue lets a later run reach the write again.
    test.statuses.rowStatus.set("a", "received");
    const second = await ran(test, id);

    expect(stepOf(first, "post")).toMatchObject({
      status: "needs_check",
      error: {
        code: "effect_needs_check",
        message: expect.stringContaining("timed out"),
      },
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(test.clock.sleeps).toEqual([]);
    // Left open on purpose: a later run finds it and stops, instead of posting twice.
    expect(await receipt(0)).toMatchObject({ status: "started" });
    expect(stepOf(second, "post").status).toBe("needs_check");
    // The event carries the code, so a reader never parses the summary for it.
    expect(
      (await eventsOf(test, id, "a")).filter((event) => event.kind === "error"),
    ).toEqual([
      expect.objectContaining({ code: "effect_needs_check" }),
      expect.objectContaining({ code: "effect_needs_check" }),
    ]);
  });

  it("closes the receipt and still stops for a check when a write reports failure after it ran", async () => {
    const { test, id, receipt } = await setup();
    test.operations.script(
      "test.write",
      failure("provider_error", {
        message: "reply was garbled",
        sideEffect: "done",
      }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "post").status).toBe("needs_check");
    expect(await receipt(0)).toMatchObject({ status: "done" });
    expect((await receipt(0))?.externalRef).toBeUndefined();
  });

  it("retries a failure that did nothing, under a fresh receipt each time, waiting through the clock", async () => {
    const { test, id, receipt } = await setup();
    test.operations.script(
      "test.write",
      failure("provider_error", { retryable: true }),
      failure("provider_error", { retryable: true }),
      posted("msg-3"),
    );

    const result = await ran(test, id);

    expect(test.operations.callsTo("test.write")).toHaveLength(3);
    expect(test.clock.sleeps).toEqual([1000, 4000]);
    expect((await receipt(0))?.status).toBe("failed");
    expect((await receipt(1))?.status).toBe("failed");
    expect(await receipt(2)).toMatchObject({
      status: "done",
      externalRef: "msg-3",
    });
    expect(stepOf(result, "post").status).toBe("succeeded");
    // The step succeeded, so no attempt is spent on the item.
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({});
  });

  it("spends an attempt when retries run out, and skips the keys they used on the next tick", async () => {
    const { test, id, receipt } = await setup({ end: endWith("released") });
    test.operations.script(
      "test.write",
      failure("provider_error", { retryable: true, message: "down" }),
      failure("provider_error", { retryable: true, message: "down" }),
      failure("provider_error", { retryable: true, message: "down" }),
      posted("msg-4"),
    );

    const first = await ran(test, id);

    expect(stepOf(first, "post")).toMatchObject({
      status: "failed",
      error: { code: "provider_error", message: "down" },
    });
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({
      attempts: 1,
    });

    // The failed item was set aside for a retry in five minutes.
    test.clock.advance(5 * 60_000);
    await ran(test, id);

    // Attempt 1 and 2 were used up by the first tick's retries; the next try is 3.
    expect((await receipt(3))?.externalRef).toBe("msg-4");
    expect(test.operations.callsTo("test.write")).toHaveLength(4);
  });

  it("does not retry a write the provider refused outright: it hands the item to a person", async () => {
    const { test, id, receipt } = await setup({ end: endWith("released") });
    test.operations.script(
      "test.write",
      failure("operation_not_allowed", { message: "not on this graph" }),
      posted("msg-2"),
    );

    const first = await ran(test, id);
    expect(stepOf(first, "post").error?.code).toBe("operation_not_allowed");
    expect((await receipt(0))?.status).toBe("failed");
    expect(test.statuses.statusOf("a")).toBe("needs_manual");

    await ran(test, id);

    // Trying the same refused write again would only be refused again.
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(await receipt(1)).toBeNull();
  });

  it("runs its writes one at a time, in list order", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([[...post()]]));
    test.operations.script(
      "test.items",
      sourceResult(["a", "b", "c"].map((name) => normalizedItem(name))),
    );
    test.operations.always("test.write", posted());

    await ran(test, id);

    expect(
      test.operations.callsTo("test.write").map((call) => call.fields.text),
    ).toEqual(["Hello Item a", "Hello Item b", "Hello Item c"]);
  });

  it("drops a response too big to keep rather than failing an item whose write already happened", async () => {
    const { test, id, receipt } = await setup();
    test.operations.script(
      "test.write",
      ok({ blob: "x".repeat(MAX_STEP_OUTPUT_BYTES) }, { externalRef: "msg-1" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "post")).toMatchObject({
      status: "succeeded",
      ports: { out: { count: 1 } },
    });
    expect((await receipt(0))?.status).toBe("done");
  });

  it("fails an item whose arguments cannot be filled, without calling", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [
          "post",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "path", path: "item.nope" } },
          },
        ],
      ]),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));

    const result = await ran(test, id);

    expect(stepOf(result, "post").error?.code).toBe("expression_failed");
    expect(test.operations.callsTo("test.write")).toHaveLength(0);
  });
});

describe("a write in a dry run or a test of one node", () => {
  it("resolves the call and records it as 'would call', without calling or writing a receipt", async () => {
    const { test, id, receipt } = await setup();

    const result = await ran(test, id, { mode: "dry" });

    expect(test.operations.callsTo("test.write")).toHaveLength(0);
    expect(await receipt(0)).toBeNull();
    const step = stepOf(result, "post");
    expect(step.status).toBe("succeeded");
    expect(step.fields).toMatchObject({
      wouldCallCount: 1,
      wouldCall: [
        { item: "a", fields: expect.stringContaining("Hello Item a") },
      ],
    });
    expect(step.receiptKeys).toBeUndefined();
    const effect = (await eventsOf(test, id, "a")).find(
      (event) => event.kind === "effect",
    );
    expect(effect).toMatchObject({
      mode: "dry",
      summary: expect.stringMatching(
        /^would call test\.write with .*Hello Item a/,
      ),
    });
    expect(test.statuses.written).toEqual([]);
    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
  });

  it("lets the item carry on with a placeholder reference marked as a dry run", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([
        [...post()],
        [
          "echo",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value:
                  "{{ nodes.post.externalRef }} {{ nodes.post.url }} {{ nodes.post.dryRun }}",
              },
            },
          },
        ],
      ]),
    );
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));

    const result = await ran(test, id, { mode: "dry" });

    expect(stepOf(result, "echo").fields?.wouldCall).toEqual([
      {
        item: "a",
        fields: expect.stringContaining("(dry run) (dry run) true"),
      },
    ]);
    expect(result.clean).toBe(true);
  });

  it("does the same for a test of that one node on sample items", async () => {
    const { test, id, receipt } = await setup();

    const result = await ran(test, id, {
      mode: "test",
      testNodeId: "post",
      sampleItems: [{ id: "sample", item: { title: "Pinned" } }],
    });

    expect(test.operations.calls).toHaveLength(0);
    expect(await receipt(0)).toBeNull();
    expect(result.steps.map((step) => step.nodeId)).toEqual(["post"]);
    expect(stepOf(result, "post").fields).toMatchObject({
      wouldCall: [
        { item: "sample", fields: expect.stringContaining("Hello Pinned") },
      ],
    });
    expect((await eventsOf(test, id, "sample"))[0]).toMatchObject({
      mode: "test",
    });
    expect(test.statuses.written).toEqual([]);
  });
});

describe("a write with a field the model writes", () => {
  const aiPost = () =>
    chain([
      [
        "post",
        "action",
        {
          operation: "test.write",
          args: { text: { mode: "ai", instruction: "Write a friendly note." } },
        },
      ],
    ]);

  it("asks the model for that field only, validates it, and sends what it wrote", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, aiPost());
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.operations.script("test.write", posted());
    test.ai.respond(aiPerItem(() => ({ text: "Hi there" })));

    await ran(test, id);

    expect(test.ai.requests).toHaveLength(1);
    expect(test.ai.requests[0]).toMatchObject({
      instruction: "Write a friendly note.",
      mode: "perItem",
      maxRepairs: 1,
      tools: [],
      resultSchemaFields: { text: { type: "string" } },
    });
    expect(test.ai.requests[0].items[0]).toMatchObject({ id: "a" });
    expect(test.operations.callsTo("test.write")[0].fields.text).toBe(
      "Hi there",
    );
  });

  it("fails the item, without a write, when the model's answer is unusable", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, aiPost());
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.ai.respond(aiPerItem(() => ({ text: "" })));

    const result = await ran(test, id);

    expect(stepOf(result, "post").error).toMatchObject({
      code: "ai_invalid_output",
    });
    expect(test.operations.callsTo("test.write")).toHaveLength(0);
  });

  it("still asks the model in a dry run, and shows what it wrote", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, aiPost());
    test.operations.script("test.items", sourceResult([normalizedItem("a")]));
    test.ai.respond(aiPerItem(() => ({ text: "Draft text" })));

    const result = await ran(test, id, { mode: "dry" });

    expect(test.ai.requests).toHaveLength(1);
    expect(stepOf(result, "post").fields).toMatchObject({
      wouldCall: [{ item: "a", fields: expect.stringContaining("Draft text") }],
    });
    expect(result.run.counts.modelCalls).toBe(1);
  });
});

describe("a write that a run dying later must not repeat", () => {
  it("is found done on the next run, so the item the run died on at the next node does not send it again", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [...post()],
          [
            "read",
            "lookup",
            {
              operation: "test.read",
              args: { key: { mode: "path", path: "item.title" } },
            },
          ],
        ],
        { end: endWith("released") },
      ),
    );
    test.operations.always("test.items", sourceResult([normalizedItem("a")]));
    test.operations.script("test.write", posted("msg-1"));
    test.operations.script(
      "test.read",
      () => {
        throw new Error("the process died after the write");
      },
      ok({ n: 1 }),
    );

    await expect(ran(test, id)).rejects.toThrow("died");
    const retry = await ran(test, id);

    // The write is keyed by the item's round, so the run that picks the item up again finds it done.
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(stepOf(retry, "post").fields).toMatchObject({ reused: 1 });
    expect(stepOf(retry, "read").status).toBe("succeeded");
  });
});
