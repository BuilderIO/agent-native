import { describe, expect, it } from "vitest";

import { receiptKey } from "../../contract.js";
import {
  chain,
  endWith,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { failure, ok } from "../../testing/fakes.js";
import { makeHost, seedWorkflow } from "../../testing/make-host.js";

const task = {
  projectId: { mode: "fixed", value: "project-1" },
  branchName: { mode: "fixed", value: "factory-{{ item.id }}" },
};

const agent = (
  op: "start" | "check" | "followUp",
  args: Record<string, unknown>,
) => ["builder", "agent", { agent: "builder", op, args }] as const;

async function setup(node: ReturnType<typeof agent>, end = endWith("done")) {
  const test = makeHost();
  const { id } = await seedWorkflow(test, chain([[...node]], { end }));
  test.operations.always("test.items", sourceResult([normalizedItem("a")]));
  return { test, id };
}

describe("an agent node", () => {
  it("starts a task as a write under a receipt and carries its branch and link forward", async () => {
    const { test, id } = await setup(
      agent("start", {
        ...task,
        prompt: { mode: "fixed", value: "Fix {{ item.title }}" },
      }),
    );
    test.operations.script(
      "builder.start",
      ok(
        { accepted: true, branchName: "factory-a" },
        { externalRef: "factory-a", url: "https://builder.test/b/factory-a" },
      ),
    );

    const result = await ran(test, id);

    expect(test.operations.callsTo("builder.start")[0]).toMatchObject({
      credentialSlot: "builder",
      mode: "live",
      fields: {
        projectId: "project-1",
        branchName: "factory-a",
        prompt: "Fix Item a",
      },
      receiptKey: receiptKey({
        workflowId: id,
        itemId: "a",
        nodeId: "builder",
        attempt: 0,
      }),
    });
    expect(stepOf(result, "builder").receiptKeys).toHaveLength(1);
    expect(
      (
        await test.store.getReceipt(
          test.scope,
          stepOf(result, "builder").receiptKeys?.[0] ?? "",
        )
      )?.externalRef,
    ).toBe("factory-a");
  });

  it("reads a task's state without a receipt, in every mode", async () => {
    const { test, id } = await setup(agent("check", task));
    test.operations.always(
      "builder.check",
      ok({ state: "working", hasPullRequest: false }),
    );

    const live = await ran(test, id);
    // The live run ended the item, so a dry run only sees it again once it is back in the queue.
    test.statuses.rowStatus.set("a", "received");
    const dry = await ran(test, id, { mode: "dry" });

    expect(
      test.operations.callsTo("builder.check").map((call) => call.mode),
    ).toEqual(["live", "dry"]);
    expect(stepOf(live, "builder").receiptKeys).toBeUndefined();
    expect(stepOf(dry, "builder").ports.out.count).toBe(1);
  });

  it("counts each follow-up that went out as a nudge, which a graph can read as item.nudges", async () => {
    const { test, id } = await setup(
      agent("followUp", {
        ...task,
        userMessage: { mode: "fixed", value: "status? continue" },
      }),
      endWith("released"),
    );
    test.operations.always(
      "builder.followUp",
      ok(null, { externalRef: "factory-a" }),
    );

    await ran(test, id);
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toMatchObject({ nudges: 1 });

    await ran(test, id);
    expect(test.operations.callsTo("builder.followUp")).toHaveLength(2);
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toMatchObject({ nudges: 2 });
  });

  it("does not count, or send again, a nudge a paused tick had already sent", async () => {
    const { test, id } = await setup(
      agent("followUp", {
        ...task,
        userMessage: { mode: "fixed", value: "status? continue" },
      }),
    );
    test.operations.script("builder.followUp", async () => {
      test.stopWhen(() => true);
      return ok(null, { externalRef: "factory-a" });
    });

    await ran(test, id);
    test.stopWhen(() => false);
    await ran(test, id);

    expect(test.operations.callsTo("builder.followUp")).toHaveLength(1);
    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({ nudges: 1 });
  });

  it("does not count a nudge in a dry run, and sends none", async () => {
    const { test, id } = await setup(
      agent("followUp", {
        ...task,
        userMessage: { mode: "fixed", value: "status? continue" },
      }),
    );

    const result = await ran(test, id, { mode: "dry" });

    expect(test.operations.callsTo("builder.followUp")).toHaveLength(0);
    expect(stepOf(result, "builder").fields).toMatchObject({
      wouldCallCount: 1,
    });
    expect(await test.store.getItemState(test.scope, id, "a")).toBeNull();
  });

  it("does not count a nudge that failed", async () => {
    const { test, id } = await setup(
      agent("followUp", {
        ...task,
        userMessage: { mode: "fixed", value: "x" },
      }),
    );
    test.operations.script("builder.followUp", failure("provider_error"));

    await ran(test, id);

    expect(
      (await test.store.getItemState(test.scope, id, "a"))?.counters,
    ).toEqual({ attempts: 1 });
  });

  it("stops for a check when a start may have gone out, so one group never becomes two branches", async () => {
    const { test, id } = await setup(
      agent("start", { ...task, prompt: { mode: "fixed", value: "Fix it" } }),
    );
    test.operations.script(
      "builder.start",
      failure("provider_error", { sideEffect: "maybe", message: "timed out" }),
    );

    const result = await ran(test, id);

    expect(stepOf(result, "builder")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
  });
});
