import { describe, expect, it } from "vitest";

import {
  chain,
  eventsOf,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { aiFailed, aiPerItem, aiWholeList, ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const assess = (extra: Record<string, unknown> = {}) =>
  [
    "assess",
    "ai",
    {
      instruction: "Is this a clear bug?",
      mode: "perItem",
      batchSize: 2,
      result: {
        clear: { type: "boolean" },
        reason: { type: "string" },
        question: { type: "string", optional: true },
      },
      ...extra,
    },
  ] as const;

const items = (count: number) =>
  sourceResult(
    Array.from({ length: count }, (_, index) =>
      normalizedItem(`m${index}`, { extras: { n: index } }),
    ),
  );

const answer = { clear: true, reason: "reproducible" };

async function setup(
  node = assess(),
  options: {
    settings?: Record<string, unknown>;
    tail?: Parameters<typeof chain>[0];
  } = {},
) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    chain([[...node], ...(options.tail ?? [])], { settings: options.settings }),
  );
  return { test, id };
}

describe("an AI node per item", () => {
  it("asks for the declared fields, in batches, and attaches each answer to its item", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", items(3));
    test.ai.respond(
      aiPerItem(() => answer, { threadId: "thread-1" }),
      aiPerItem(() => ({ ...answer, question: "Which browser?" })),
    );

    const result = await ran(test, id);

    expect(
      test.ai.requests.map((request) => request.items.map((item) => item.id)),
    ).toEqual([["m0", "m1"], ["m2"]]);
    expect(test.ai.requests[0]).toMatchObject({
      instruction: "Is this a clear bug?",
      mode: "perItem",
      maxRepairs: 1,
      tools: [],
      resultSchemaFields: {
        clear: { type: "boolean" },
        reason: { type: "string" },
        question: { type: "string", optional: true },
      },
    });
    expect(test.ai.requests[0].items[0]).toMatchObject({
      id: "m0",
      item: { title: "Item m0", extras: { n: 0 } },
      nodes: {},
    });
    const step = stepOf(result, "assess");
    expect(step.ports.out.itemIds).toEqual(["m0", "m1", "m2"]);
    expect(step.agentThreadId).toBe("thread-1");
    expect(result.run.counts.modelCalls).toBe(2);
    const event = (await eventsOf(test, id, "m0")).find(
      (entry) => entry.nodeId === "assess",
    );
    expect(event).toMatchObject({ kind: "output", threadId: "thread-1" });
    expect(event?.summary).toContain('"question":null');
  });

  it("lets a later node read the answer, and a missing optional field as null", async () => {
    const { test, id } = await setup(assess(), {
      tail: [
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: {
                mode: "fixed",
                value: "{{ nodes.assess.reason }}/{{ nodes.assess.clear }}",
              },
            },
          },
        ],
      ],
    });
    test.operations.script("test.items", items(1));
    test.operations.script("test.write", ok(null, { externalRef: "r" }));
    test.ai.respond(aiPerItem(() => answer));

    await ran(test, id);

    expect(test.operations.callsTo("test.write")[0].fields.text).toBe(
      "reproducible/true",
    );
  });

  it("makes no call when there is nothing to judge", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", items(0));

    const result = await ran(test, id);

    expect(test.ai.requests).toHaveLength(0);
    expect(stepOf(result, "assess").status).toBe("succeeded");
  });

  it("passes the input budget and records when the runner had to cut", async () => {
    const { test, id } = await setup(
      assess({ inputBudgetTokens: 5000, batchSize: 10 }),
    );
    test.operations.script("test.items", items(1));
    test.ai.respond(aiPerItem(() => answer, { inputTruncated: true }));

    const result = await ran(test, id);

    expect(test.ai.requests[0].inputBudgetTokens).toBe(5000);
    expect(stepOf(result, "assess").inputTruncated).toBe(true);
  });

  it("fails an item the model did not answer, or answered wrongly, and never passes it on", async () => {
    const { test, id } = await setup(assess({ batchSize: 10 }), {
      tail: [
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "fixed", value: "ok" } },
          },
        ],
      ],
    });
    test.operations.script("test.items", items(4));
    test.operations.always("test.write", ok(null, { externalRef: "r" }));
    test.ai.respond(() => ({
      ok: true,
      mode: "perItem",
      usage: { modelCalls: 1 },
      results: [
        { itemId: "m0", ok: true, fields: answer },
        // m1 is missing entirely.
        { itemId: "m2", ok: true, fields: { clear: "yes", reason: "r" } },
        {
          itemId: "m3",
          ok: false,
          code: "no_result",
          reason: "prose, no result",
        },
      ],
    }));

    const result = await ran(test, id);

    const step = stepOf(result, "assess");
    expect(step.ports.out.itemIds).toEqual(["m0"]);
    expect(test.operations.callsTo("test.write")).toHaveLength(1);
    expect(result.run.counts.itemFailures).toBe(3);
    const messages = await Promise.all(
      ["m1", "m2", "m3"].map(async (item) => {
        const error = (await eventsOf(test, id, item)).find(
          (entry) => entry.kind === "error",
        );
        return error?.summary;
      }),
    );
    expect(messages).toEqual([
      "ai_invalid_output: The AI turn returned nothing for this item.",
      expect.stringMatching(
        /^ai_invalid_output: The AI answer does not fit the declared fields: "clear" must be true or false/,
      ),
      "ai_invalid_output: The AI turn failed (no_result): prose, no result",
    ]);
  });

  it.each([
    ["no_result", "ai_invalid_output"],
    ["result_invalid", "ai_invalid_output"],
    ["timeout", "provider_error"],
    ["credentials", "credential_missing"],
    ["engine_error", "engine_error"],
  ] as const)(
    "maps a failed turn (%s) to %s for every item in the batch",
    async (aiCode, code) => {
      const { test, id } = await setup();
      test.operations.script("test.items", items(2));
      test.ai.respond(aiFailed(aiCode, "nope"));

      const result = await ran(test, id);

      const step = stepOf(result, "assess");
      expect(step.error).toEqual({
        code,
        message: `The AI turn failed (${aiCode}): nope`,
      });
      expect(step.ports.out.count).toBe(0);
      expect(result.run.counts.itemFailures).toBe(2);
    },
  );

  it("fails the batch when the runner answers for the whole list instead", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", items(1));
    test.ai.respond(aiWholeList(answer));

    const result = await ran(test, id);

    expect(stepOf(result, "assess").error?.code).toBe("ai_invalid_output");
  });
});

describe("the model-call cap", () => {
  it("pauses the run when a batch would go over it, lets what was answered go on, and sets the rest aside", async () => {
    const { test, id } = await setup(assess(), {
      settings: { modelCallCap: 1 },
    });
    test.operations.script("test.items", items(3));
    test.ai.respond(
      aiPerItem(() => answer),
      aiPerItem(() => answer),
    );

    const result = await ran(test, id);

    // The second batch is never sent: the engine will not ask past the cap.
    expect(test.ai.requests).toHaveLength(1);
    expect(result.run).toMatchObject({
      status: "paused",
      error: {
        code: "budget_paused",
        message: expect.stringContaining("cap of 1"),
      },
      counts: { modelCalls: 1 },
    });
    const step = stepOf(result, "assess");
    expect(step).toMatchObject({
      status: "failed",
      error: { code: "ai_cap_reached" },
      fields: { deferred: 1 },
    });
    // The batch that was answered goes on, and ends; the one the cap kept from the model waits for the next tick.
    expect(step.ports.out.itemIds).toEqual(["m0", "m1"]);
    expect(stepOf(result, "done")).toMatchObject({
      status: "succeeded",
      fields: { outcome: "done" },
    });
    expect(result.clean).toBe(false);
    expect(test.statuses.written).toEqual([
      expect.objectContaining({ itemId: "m0", status: "resolved" }),
      expect.objectContaining({ itemId: "m1", status: "resolved" }),
    ]);
    expect(await test.store.getItemState(test.scope, id, "m2")).toMatchObject({
      parkedAtNode: "assess",
      wake: { wait: "retry" },
    });
    expect(
      (await test.store.getItemState(test.scope, id, "m2"))?.leasedBy,
    ).toBeUndefined();
  });

  it("stops before the first call when an earlier node used the whole cap", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain(
        [
          [
            "write",
            "action",
            {
              operation: "test.write",
              args: { text: { mode: "ai", instruction: "Write it." } },
            },
          ],
          [...assess()],
        ],
        { settings: { modelCallCap: 1 } },
      ),
    );
    test.operations.script("test.items", items(1));
    test.operations.script("test.write", ok(null, { externalRef: "r" }));
    test.ai.respond(aiPerItem(() => ({ text: "hi" })));

    const result = await ran(test, id);

    expect(test.ai.requests).toHaveLength(1);
    expect(result.run.status).toBe("paused");
    expect(stepOf(result, "assess")).toMatchObject({
      status: "failed",
      error: { code: "ai_cap_reached" },
    });
  });
});

describe("an AI node over the whole list", () => {
  const wholeList = () =>
    assess({
      mode: "wholeList",
      result: { groups: { type: "array" } },
    });

  it("asks once for everything and passes on one item that stands for all of them", async () => {
    const { test, id } = await setup(wholeList());
    test.operations.script("test.items", items(3));
    test.ai.respond(
      aiWholeList({ groups: [["m0", "m1"], ["m2"]] }, { threadId: "t9" }),
    );

    const result = await ran(test, id);

    expect(test.ai.requests).toHaveLength(1);
    expect(test.ai.requests[0]).toMatchObject({
      mode: "wholeList",
      items: [{ id: "m0" }, { id: "m1" }, { id: "m2" }],
    });
    const step = stepOf(result, "assess");
    expect(step.ports.out.count).toBe(1);
    expect(step.ports.out.itemIds[0]).toMatch(/^ai:assess:[0-9a-f]+$/);
    expect(step.agentThreadId).toBe("t9");
    // The one item stands for the three inbox items, so ending it ends them.
    expect(test.statuses.written.map((entry) => entry.itemId)).toEqual([
      "m0",
      "m1",
      "m2",
    ]);
  });

  it("fails every item when the answer does not fit, and passes nothing on", async () => {
    const { test, id } = await setup(wholeList());
    test.operations.script("test.items", items(2));
    test.ai.respond(aiWholeList({ groups: "none" }));

    const result = await ran(test, id);

    expect(stepOf(result, "assess").ports.out.count).toBe(0);
    expect(result.run.counts.itemFailures).toBe(2);
  });

  it("fails every item when the model fails", async () => {
    const { test, id } = await setup(wholeList());
    test.operations.script("test.items", items(2));
    test.ai.respond(aiFailed("timeout"));

    const result = await ran(test, id);

    expect(stepOf(result, "assess").error?.code).toBe("provider_error");
    expect(result.run.counts.itemFailures).toBe(2);
  });

  it("fails every item when the runner answers per item instead", async () => {
    const { test, id } = await setup(wholeList());
    test.operations.script("test.items", items(1));
    test.ai.respond(aiPerItem(() => ({ groups: [] })));

    const result = await ran(test, id);

    expect(stepOf(result, "assess").error?.code).toBe("ai_invalid_output");
  });

  it("pauses, not fails, when the runner itself runs out of calls partway through a turn", async () => {
    const { test, id } = await setup(wholeList());
    test.operations.script("test.items", items(2));
    test.ai.respond(aiFailed("budget", "ran out repairing"));

    const result = await ran(test, id);

    expect(result.run.status).toBe("paused");
    expect(stepOf(result, "assess")).toMatchObject({
      status: "failed",
      error: { code: "ai_cap_reached" },
    });
    expect(result.run.counts.itemFailures).toBe(0);
    expect(test.statuses.written).toEqual([]);
  });
});

describe("the tools an AI node may use", () => {
  it("hands the runner reads it was allowed", async () => {
    const { test, id } = await setup(assess({ tools: ["test.read"] }));
    test.operations.script("test.items", items(1));
    test.ai.respond(aiPerItem(() => answer));

    await ran(test, id);

    expect(test.ai.requests[0].tools).toEqual(["test.read"]);
  });

  it("refuses a tool that writes, before the run starts or any model is asked", async () => {
    const { test, id } = await setup(assess({ tools: ["test.write"] }));
    test.operations.script("test.items", items(1));

    const result = await ran(test, id);

    expect(result.run).toMatchObject({
      status: "failed",
      error: {
        code: "graph_invalid",
        message: expect.stringContaining(
          "unknown_tool at assess (test.write writes, and a model may only be given reads)",
        ),
      },
    });
    expect(result.steps).toEqual([]);
    expect(test.operations.calls).toHaveLength(0);
    expect(test.ai.requests).toHaveLength(0);
  });

  it("refuses a tool that is not in the catalog the same way", async () => {
    const { test, id } = await setup(assess({ tools: ["test.nowhere"] }));
    test.operations.script("test.items", items(1));

    const result = await ran(test, id);

    expect(result.run.error).toMatchObject({
      code: "graph_invalid",
      message: expect.stringContaining(
        "unknown_tool at assess (test.nowhere is not an operation Factory has)",
      ),
    });
    expect(test.ai.requests).toHaveLength(0);
  });
});

describe("what a turn could not save beside its answer", () => {
  it("records a thread that was not saved on the step, and still uses the answer", async () => {
    const { test, id } = await setup(assess({ batchSize: 10 }));
    test.operations.script("test.items", items(2));
    test.ai.respond(
      aiPerItem(() => answer, { threadPersistError: "thread store down" }),
    );

    const result = await ran(test, id);

    const step = stepOf(result, "assess");
    expect(step.fields).toMatchObject({
      threadPersistError: "thread store down",
    });
    expect(step.fields).not.toHaveProperty("usageRecordError");
    expect(step.agentThreadId).toBeUndefined();
    expect(step.ports.out.itemIds).toEqual(["m0", "m1"]);
    expect(step.status).toBe("succeeded");
  });

  it("records a usage row that was not written, so a cost count is not trusted blindly", async () => {
    const { test, id } = await setup(
      assess({
        mode: "wholeList",
        result: { groups: { type: "array" } },
      }),
    );
    test.operations.script("test.items", items(2));
    test.ai.respond(
      aiWholeList({ groups: [] }, { usageRecordError: "usage table down" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "assess").fields).toMatchObject({
      usageRecordError: "usage table down",
    });
  });

  it("keeps the first message and counts the turns when several in one step had one", async () => {
    const { test, id } = await setup(assess({ batchSize: 1 }));
    test.operations.script("test.items", items(3));
    test.ai.respond(
      aiPerItem(() => answer, { threadPersistError: "first failure" }),
      aiPerItem(() => answer),
      aiPerItem(() => answer, { threadPersistError: "third failure" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "assess").fields).toMatchObject({
      threadPersistError: "first failure",
      threadPersistErrorTurns: 2,
    });
  });

  it("records it when the turn itself failed too", async () => {
    const { test, id } = await setup();
    test.operations.script("test.items", items(1));
    test.ai.respond(() => ({
      ok: false,
      code: "timeout",
      reason: "slow",
      usage: { modelCalls: 1 },
      threadPersistError: "thread store down",
    }));

    const result = await ran(test, id);

    expect(stepOf(result, "assess")).toMatchObject({
      status: "failed",
      fields: { threadPersistError: "thread store down" },
    });
  });

  it("records it on an action that had the model write a field", async () => {
    const { test, id } = await setup(assess(), {
      tail: [
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: {
              text: { mode: "ai", instruction: "Write a note." },
            },
          },
        ],
      ],
    });
    test.operations.script("test.items", items(1));
    test.operations.script("test.write", ok(null, { externalRef: "r" }));
    test.ai.respond(
      aiPerItem(() => answer),
      aiPerItem(() => ({ text: "a note" }), {
        threadPersistError: "thread store down",
      }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "say").fields).toMatchObject({
      threadPersistError: "thread store down",
    });
  });
});

describe("the node a turn belongs to", () => {
  it("is named on every turn, so the tripwire events of a turn say which node it was for", async () => {
    const { test, id } = await setup(assess({ batchSize: 1 }), {
      tail: [
        [
          "say",
          "action",
          {
            operation: "test.write",
            args: { text: { mode: "ai", instruction: "Write a note." } },
          },
        ],
      ],
    });
    test.operations.script("test.items", items(2));
    test.operations.always("test.write", ok(null, { externalRef: "r" }));
    test.ai.always(
      aiPerItem((item) => (item.nodes.assess ? { text: "n" } : answer)),
    );
    test.ai.respond(
      aiPerItem(() => answer),
      aiPerItem(() => answer),
    );

    await ran(test, id);

    expect(
      test.ai.requests.map((request) => [request.runId, request.nodeId]),
    ).toEqual([
      ["run-1", "assess"],
      ["run-1", "assess"],
      ["run-1", "say"],
      ["run-1", "say"],
    ]);
  });

  it("is named on a turn for the whole list too", async () => {
    const { test, id } = await setup(
      assess({ mode: "wholeList", result: { groups: { type: "array" } } }),
    );
    test.operations.script("test.items", items(2));
    test.ai.respond(aiWholeList({ groups: [] }));

    await ran(test, id);

    expect(test.ai.requests.map((request) => request.nodeId)).toEqual([
      "assess",
    ]);
  });
});
