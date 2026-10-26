import { describe, expect, it } from "vitest";

import { WORKFLOW_STORE_LIMITS } from "../adapter.js";
import { receiptKey } from "../contract.js";
import { jsonByteLength } from "../items.js";
import type { NodeSpec } from "../story-graphs.fixture.js";
import {
  T0,
  eventsOf,
  last,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
  waitGraph,
} from "../testing/engine-fixtures.js";
import { ok } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";
import { boundReceiptOutput } from "./receipt-output.js";

const postQuestion = (): NodeSpec => [
  "post",
  "action",
  {
    operation: "test.write",
    args: { text: { mode: "fixed", value: "question" } },
  },
];

const readAfter = (key: Record<string, unknown>): NodeSpec => [
  "after",
  "lookup",
  { operation: "test.read", args: { key } },
];

const flagAfter = (flag: Record<string, unknown>): NodeSpec => [
  "after",
  "lookup",
  { operation: "test.typed", args: { flag } },
];

async function setup(after: NodeSpec) {
  const test = makeHost();
  const { id } = await seedWorkflow(
    test,
    waitGraph(
      {
        wait: "reply",
        limitHours: 4,
        acceptFrom: "anyone",
        watch: { fromNode: "post" },
      },
      { before: [postQuestion(), after] },
    ),
  );
  test.operations.script("test.items", sourceResult([normalizedItem("a")]));
  test.operations.always("test.read", ok({ v: 1 }));
  test.operations.always("test.typed", ok({ v: 1 }));
  return { test, id };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** What an earlier run leaves when it made the post and stopped before the item finished: the post's receipt, closed. */
async function leavePostDone(
  { test, id }: Setup,
  closed: {
    output?: Record<string, unknown>;
    outputTruncated?: boolean;
    externalRef?: string;
  },
) {
  const key = receiptKey({
    workflowId: id,
    itemId: "a",
    nodeId: "post",
    attempt: 0,
  });
  await test.store.putReceipt(test.scope, id, {
    key,
    status: "started",
    at: T0,
  });
  await test.store.putReceipt(test.scope, id, {
    key,
    status: "done",
    ...closed,
    at: T0,
  });
}

const slackPostReceipt = {
  output: { channel: "C1", ts: "1760000000.000100" },
  externalRef: "1760000000.000100",
};

describe("a write found already done on a later run", () => {
  it("still leaves the thread a reply Wait after it watches", async () => {
    const run = await setup(readAfter({ mode: "fixed", value: "k" }));
    await leavePostDone(run, slackPostReceipt);

    const result = await ran(run.test, run.id);

    expect(run.test.operations.callsTo("test.write")).toHaveLength(0);
    expect(stepOf(result, "post").fields?.reused).toBe(1);
    expect(result.run.counts.itemFailures).toBe(0);
    expect(result.run.counts.parked).toBe(1);
    const [parked] = await run.test.store.listDueParked(run.test.scope, {
      workflowId: run.id,
      now: "2099-01-01T00:00:00.000Z",
      limit: 5,
    });
    expect(parked.wake?.thread).toEqual({
      channelId: "C1",
      threadTs: "1760000000.000100",
    });
  });

  it("hands the next node the same fields a fresh write would have", async () => {
    const run = await setup(
      readAfter({ mode: "path", path: "nodes.post.channel" }),
    );
    await leavePostDone(run, slackPostReceipt);

    await ran(run.test, run.id);

    const reads = run.test.operations.callsTo("test.read");
    expect(reads).toHaveLength(1);
    expect(reads[0].fields.key).toBe("C1");
  });

  it("carries the receipt's reference beside the response, as a fresh write does", async () => {
    const run = await setup(
      readAfter({ mode: "path", path: "nodes.post.externalRef" }),
    );
    await leavePostDone(run, { externalRef: "msg-7" });

    await ran(run.test, run.id);

    expect(run.test.operations.callsTo("test.read")[0].fields.key).toBe(
      "msg-7",
    );
  });

  it("says in the journey that it was reused, and what it returned", async () => {
    const run = await setup(readAfter({ mode: "fixed", value: "k" }));
    await leavePostDone(run, slackPostReceipt);

    await ran(run.test, run.id);

    const effects = (await eventsOf(run.test, run.id, "a")).filter(
      (event) => event.kind === "effect",
    );
    const reused = last(effects).summary;
    expect(reused).toContain("already done, reused test.write");
    expect(reused).toContain("1760000000.000100");
  });

  it("marks a result whose response was only partly kept, so a node reading what was cut is told why", async () => {
    const run = await setup(
      flagAfter({ mode: "path", path: "nodes.post.outputTruncated" }),
    );
    await leavePostDone(run, { ...slackPostReceipt, outputTruncated: true });

    await ran(run.test, run.id);

    const reads = run.test.operations.callsTo("test.typed");
    expect(reads).toHaveLength(1);
    expect(reads[0].fields.flag).toBe(true);
  });

  it("does not mark a result whose response was kept whole", async () => {
    const run = await setup(
      flagAfter({ mode: "path", path: "nodes.post.outputTruncated" }),
    );
    await leavePostDone(run, slackPostReceipt);

    const result = await ran(run.test, run.id);

    // The flag is not on the result, so the binding has no value and the item fails.
    expect(run.test.operations.callsTo("test.typed")).toHaveLength(0);
    expect(result.run.counts.itemFailures).toBe(1);
  });
});

describe("the receipt a live write closes", () => {
  async function postedWith(response: ReturnType<typeof ok>) {
    const run = await setup(readAfter({ mode: "fixed", value: "k" }));
    run.test.operations.always("test.write", response);
    const result = await ran(run.test, run.id);
    const [key] = stepOf(result, "post").receiptKeys ?? [];
    return run.test.store.getReceipt(run.test.scope, key);
  }

  it("keeps the response when it fits, and does not call it cut", async () => {
    const receipt = await postedWith(
      ok(
        { channel: "C1", ts: "1760000000.000100" },
        { externalRef: "1760000000.000100" },
      ),
    );

    expect(receipt).toMatchObject({
      status: "done",
      externalRef: "1760000000.000100",
      output: { channel: "C1", ts: "1760000000.000100" },
    });
    expect(receipt?.outputTruncated).toBeUndefined();
  });

  it("keeps a response that is too big only as far as it fits, with the identifiers a Wait needs, and says it was cut", async () => {
    const big = {
      channel: "C1",
      ts: "1760000000.000100",
      message: { text: "x".repeat(20_000), user: "U1" },
      history: Array.from({ length: 400 }, (_, index) => ({
        ts: `${index}.0`,
        text: "y".repeat(80),
      })),
    };

    const receipt = await postedWith(ok(big, { externalRef: "r" }));

    expect(jsonByteLength(receipt?.output)).toBeLessThanOrEqual(
      WORKFLOW_STORE_LIMITS.receiptOutputBytes,
    );
    expect(receipt?.output).toMatchObject({ channel: "C1", ts: big.ts });
    expect(receipt?.outputTruncated).toBe(true);
    expect(JSON.stringify(receipt?.output)).not.toContain("xxxxxxxx");
  });

  it("is what the engine bounds a response to, so a later run reads back exactly that", async () => {
    const response = { channel: "C1", ts: "1.1", body: "z".repeat(5_000) };

    const receipt = await postedWith(ok(response, { externalRef: "r" }));

    const bounded = boundReceiptOutput(response);
    expect(receipt?.output).toEqual(bounded?.output);
    expect(receipt?.outputTruncated).toBe(bounded?.truncated);
  });

  it("keeps no response for a write that returned none", async () => {
    const receipt = await postedWith(ok(null, { externalRef: "r" }));

    expect(receipt?.status).toBe("done");
    expect(receipt?.output).toBeUndefined();
    expect(receipt?.outputTruncated).toBeUndefined();
  });
});
