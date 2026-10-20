import { describe, expect, it } from "vitest";

import { WORKFLOW_STORE_LIMITS, WorkflowStoreError } from "../adapter.js";
import {
  chain,
  minutesAfter,
  ran,
  sourceResult,
  startedByHand,
  tick,
} from "../testing/engine-fixtures.js";
import { makeHost, seedWorkflow, type TestHost } from "../testing/make-host.js";

const LEASE_MINUTES = WORKFLOW_STORE_LIMITS.leaseTtlMs / 60_000;

/** A run a killed function left behind: started at `startedAt` and never finished. */
async function leftRunning(
  test: TestHost,
  workflowId: string,
  tickKey: string,
  startedAt: string,
) {
  const { run } = await test.store.startRun(test.scope, {
    workflowId,
    tickKey,
    mode: "live",
    ...startedByHand(),
    graphVersion: 1,
    startedAt,
  });
  return run;
}

const statusOf = async (test: TestHost, runId: string) =>
  (await test.store.getRun(test.scope, runId))?.run;

describe("a run row left running by a function that was killed", () => {
  it("is marked interrupted at the start of the workflow's next tick", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    const stale = await leftRunning(
      test,
      id,
      "died",
      minutesAfter(-(LEASE_MINUTES + 5)),
    );

    await ran(test, id);

    expect(await statusOf(test, stale.id)).toMatchObject({
      status: "failed",
      error: { code: "run_interrupted" },
      counts: stale.counts,
    });
  });

  it("does not touch a run that is still within its lease: it may be alive", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    const alive = await leftRunning(
      test,
      id,
      "working",
      minutesAfter(-(LEASE_MINUTES - 1)),
    );

    await ran(test, id);

    expect((await statusOf(test, alive.id))?.status).toBe("running");
  });

  it("is not reaped within the time the scheduler lets a tick run, when that is longer than a lease", async () => {
    // A hard timeout of 25 minutes, and a run that has been going for 29: within it and its margin.
    const test = makeHost({ runTimeoutMs: 25 * 60_000 });
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    const alive = await leftRunning(test, id, "slow", minutesAfter(-29));

    await ran(test, id);

    expect((await statusOf(test, alive.id))?.status).toBe("running");
  });

  it("is reaped once the time the scheduler lets a tick run, and a margin, has passed", async () => {
    const test = makeHost({ runTimeoutMs: 25 * 60_000 });
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    const stale = await leftRunning(test, id, "died", minutesAfter(-31));

    await ran(test, id);

    expect((await statusOf(test, stale.id))?.status).toBe("failed");
  });

  it("is never reaped sooner than a lease, whatever the scheduler's own limit", async () => {
    const test = makeHost({ runTimeoutMs: 2 * 60_000 });
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    const alive = await leftRunning(
      test,
      id,
      "working",
      minutesAfter(-(LEASE_MINUTES - 1)),
    );

    await ran(test, id);

    expect((await statusOf(test, alive.id))?.status).toBe("running");
  });

  it("is reaped even when the tick has nothing to do, so an idle workflow does not read running for ever", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    await ran(test, id);
    const stale = await leftRunning(
      test,
      id,
      "died",
      minutesAfter(-(LEASE_MINUTES + 1)),
    );
    test.clock.set(minutesAfter(1));

    const result = await tick(test, id, {
      scheduledFor: minutesAfter(0),
    });

    expect(result.kind).toBe("nothing_due");
    expect((await statusOf(test, stale.id))?.status).toBe("failed");
  });

  it("leaves another workflow's rows alone", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]), { id: "one" });
    const other = await seedWorkflow(test, chain([]), { id: "two" });
    test.operations.always("test.items", sourceResult([]));
    const elsewhere = await leftRunning(
      test,
      other.id,
      "died",
      minutesAfter(-(LEASE_MINUTES + 5)),
    );

    await ran(test, id);

    expect((await statusOf(test, elsewhere.id))?.status).toBe("running");
  });

  it("carries on when another tick finished the row between the list and the finish", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(test, chain([]));
    test.operations.always("test.items", sourceResult([]));
    await leftRunning(test, id, "died", minutesAfter(-(LEASE_MINUTES + 5)));
    const finishRun = test.store.finishRun.bind(test.store);
    let raced = false;
    test.store.finishRun = async (scope, input) => {
      if (!raced) {
        raced = true;
        throw new WorkflowStoreError(
          "invalid_transition",
          "Run already finished as failed.",
          { runId: input.runId },
        );
      }
      return finishRun(scope, input);
    };

    const result = await ran(test, id);

    expect(raced).toBe(true);
    expect(result.run.status).toBe("succeeded");
  });
});
