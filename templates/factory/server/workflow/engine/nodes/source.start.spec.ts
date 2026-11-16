import { describe, expect, it } from "vitest";

import type { StepRecord } from "../../contract.js";
import {
  chain,
  normalizedItem,
  ran,
  stepOf,
} from "../../testing/engine-fixtures.js";
import { makeHost, reenable, seedWorkflow } from "../../testing/make-host.js";

/** The entry at `index`, or a loud failure: a test reads what it expects to be there. */
function nth<T>(list: readonly T[], index: number): T {
  const found = list.find((_, at) => at === index);
  if (found === undefined) throw new Error(`There is no entry ${index}.`);
  return found;
}

/** What the step sent out of its `out` port. */
function out(step: StepRecord) {
  const port = Object.entries(step.ports).find(([name]) => name === "out");
  if (!port) throw new Error(`Step "${step.nodeId}" has no out port.`);
  return port[1];
}

// An inbox source starts from the moment its workflow goes live: the first live
// read takes the newest position and no item, and every later read goes on from
// the position the last live run saved. A dry or test run only shows a sample.

const SOURCE = {
  source: "inbox-poll",
  poller: "slack",
  takeLimit: 5,
  filter: { scopes: ["C1"] },
};

async function setup() {
  const test = makeHost();
  const { id } = await seedWorkflow(test, chain([], { source: SOURCE }));
  const cursor = () =>
    test.store.getSourceCursor(test.scope, { workflowId: id, nodeId: "src" });
  return { test, id, cursor };
}

const primedAt = (position: string) =>
  ({ ok: true, items: [], primed: true, position }) as const;

describe("the first live read of an inbox source", () => {
  it("asks to start from now, takes nothing, and says so in the step and the run's counts", async () => {
    const { test, id } = await setup();
    test.inbox.script("inbox-poll", primedAt("p1"));

    const result = await ran(test, id);

    expect(nth(test.inbox.requests, 0)).toMatchObject({
      mode: "live",
      start: { kind: "prime" },
    });
    const step = stepOf(result, "src");
    expect(step.status).toBe("succeeded");
    expect(step.fields).toMatchObject({
      source: "inbox-poll",
      primed: true,
      ingested: false,
      taken: 0,
      cursorAfter: "p1",
    });
    expect(out(step).count).toBe(0);
    // A quiet first run is told apart from a run over an empty channel.
    expect(result.run.counts).toMatchObject({ taken: 0, primed: 1 });
  });

  it("saves the position it was handed, so the next run goes on from it", async () => {
    const { test, id, cursor } = await setup();
    test.inbox.script("inbox-poll", primedAt("p1"));
    await ran(test, id);
    expect((await cursor())?.value).toBe("p1");

    test.inbox.script("inbox-poll", {
      ok: true,
      items: [normalizedItem("m1")],
      position: "p2",
    });
    const second = await ran(test, id);

    expect(nth(test.inbox.requests, 1).start).toEqual({
      kind: "from",
      position: "p1",
    });
    const step = stepOf(second, "src");
    expect(step.fields).toMatchObject({ ingested: true, cursorAfter: "p2" });
    expect(step.fields).not.toHaveProperty("primed");
    expect(second.run.counts).toMatchObject({ taken: 1, primed: 0 });
    expect((await cursor())?.value).toBe("p2");
  });

  it("is retried from now when the run failed, and saves no position of a failed run", async () => {
    const { test, id, cursor } = await setup();
    test.inbox.script("inbox-poll", {
      ok: false,
      code: "provider_error",
      message: "Slack is down",
      retryable: false,
    });
    const failed = await ran(test, id);
    expect(failed.run.status).toBe("failed");
    expect(await cursor()).toBeNull();

    test.inbox.script("inbox-poll", primedAt("p1"));
    await ran(test, id);

    expect(nth(test.inbox.requests, 1).start).toEqual({ kind: "prime" });
    expect((await cursor())?.value).toBe("p1");
  });

  it("keeps the position when the workflow is turned off and on, and does not start over", async () => {
    const { test, id, cursor } = await setup();
    test.inbox.script("inbox-poll", primedAt("p1"));
    await ran(test, id);
    await test.store.setWorkflowEnabled(test.scope, id, false);
    await reenable(test, id);
    test.inbox.script("inbox-poll", { ok: true, items: [], position: "p1" });

    const result = await ran(test, id);

    expect(nth(test.inbox.requests, 1).start).toEqual({
      kind: "from",
      position: "p1",
    });
    expect(stepOf(result, "src").fields).not.toHaveProperty("primed");
    expect((await cursor())?.value).toBe("p1");
  });
});

describe("a workflow that was already running when positions were added", () => {
  it("reads as it did: no start, and a source that saves no position saves none", async () => {
    const { test, id, cursor } = await setup();
    await test.store.recordTriggerRun(test.scope, {
      workflowId: id,
      at: "2026-10-19T11:00:00.000Z",
    });
    test.inbox.script("inbox-poll", {
      ok: true,
      items: [normalizedItem("m1")],
    });

    const result = await ran(test, id);

    expect(nth(test.inbox.requests, 0)).not.toHaveProperty("start");
    expect(stepOf(result, "src").fields).toMatchObject({ ingested: true });
    expect(stepOf(result, "src").fields).not.toHaveProperty("primed");
    expect(result.run.counts).toMatchObject({ taken: 1, primed: 0 });
    expect(await cursor()).toBeNull();
  });
});

describe("a dry or test run of an inbox source", () => {
  it("shows a sample, says a live run would start from now, and saves nothing", async () => {
    const { test, id, cursor } = await setup();
    test.inbox.script("inbox-poll", {
      ok: true,
      items: [normalizedItem("m1"), normalizedItem("m2")],
      sample: true,
    });

    const dry = await ran(test, id, { mode: "dry" });

    expect(nth(test.inbox.requests, 0)).toMatchObject({
      mode: "dry",
      start: { kind: "prime" },
    });
    const step = stepOf(dry, "src");
    expect(step.fields).toMatchObject({
      sample: true,
      wouldPrime: true,
      ingested: false,
    });
    expect(step.fields).not.toHaveProperty("primed");
    expect(out(step).count).toBe(2);
    expect(dry.run.counts).toMatchObject({ primed: 0 });
    expect(await cursor()).toBeNull();
  });

  it("does not move the position of a source that has one, and does not claim it would start over", async () => {
    const { test, id, cursor } = await setup();
    test.inbox.script("inbox-poll", primedAt("p1"));
    await ran(test, id);
    test.inbox.script("inbox-poll", {
      ok: true,
      items: [normalizedItem("m1")],
      sample: true,
      position: "p9",
    });

    const dry = await ran(test, id, { mode: "dry" });

    expect(nth(test.inbox.requests, 1).start).toEqual({
      kind: "from",
      position: "p1",
    });
    expect(stepOf(dry, "src").fields).toMatchObject({
      sample: true,
      cursorHeld: "not a live run",
    });
    expect(stepOf(dry, "src").fields).not.toHaveProperty("wouldPrime");
    expect((await cursor())?.value).toBe("p1");
  });

  it("does not turn the first live run into a continuation, because a dry run came first", async () => {
    const { test, id } = await setup();
    test.inbox.script("inbox-poll", { ok: true, items: [], sample: true });
    await ran(test, id, { mode: "dry" });
    test.inbox.script("inbox-poll", primedAt("p1"));

    const live = await ran(test, id);

    expect(nth(test.inbox.requests, 1).start).toEqual({ kind: "prime" });
    expect(live.run.counts).toMatchObject({ primed: 1 });
  });
});

describe("a status source", () => {
  it("has no position and is never asked to start from now", async () => {
    const test = makeHost();
    const { id } = await seedWorkflow(
      test,
      chain([], {
        source: {
          source: "status",
          status: "automation_started",
          takeLimit: 5,
        },
      }),
    );
    test.inbox.script("status", { ok: true, items: [normalizedItem("m1")] });

    const result = await ran(test, id);

    expect(nth(test.inbox.requests, 0)).not.toHaveProperty("start");
    expect(stepOf(result, "src").fields).not.toHaveProperty("primed");
    expect(result.run.counts).toMatchObject({ taken: 1, primed: 0 });
  });
});
