import { describe, expect, it } from "vitest";

import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";

const STORY = "activation-nudge";
const CUSTOMER = "nadia@acme-labs.example.test";
const OWNER = "account-owner@example.test";
const DAY_MS = 24 * 60 * 60 * 1000;

const sourceStep = (
  run: Awaited<ReturnType<typeof scenarioRun>>["run"],
  tick: number,
) => {
  const step = run.ticks[tick].steps.find((entry) => entry.nodeId === "subs");
  if (!step) throw new Error(`Tick ${tick} has no "subs" step.`);
  return step;
};

describe("story 9 proofs: the activation nudge", () => {
  it("waits three days, then emails an inactive customer once and tells the account owner once", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "an-inactive-customer-is-nudged-exactly-three-days-later",
    );

    const [email] = effectsOf(summary, "email.send");
    const [slack] = effectsOf(summary, "slack.postMessage");
    expect(effectsOf(summary)).toHaveLength(2);
    expect(email.fields).toMatchObject({ to: CUSTOMER });
    expect(email.receipt).toMatchObject({ status: "done" });
    expect(slack.fields).toMatchObject({ to: OWNER });
    expect(String(slack.fields.text)).toContain(CUSTOMER);
    expect(summary.statuses).toEqual({ sub_nadia: "resolved" });
    expect(summary.parked).toEqual([]);

    // One hour before the deadline, with the customer parked, nothing was read or sent.
    expect(tickAt(summary, 2)).toMatchObject({
      calls: { "stripe.newSubscriptions": 1 },
      effects: [],
    });
    expect(tickAt(summary, 2).run?.counts.woke).toBeUndefined();
    // Exactly three days after the subscription was taken, it woke and was read.
    expect(tickAt(summary, 3).at).toBe("2026-10-22T13:00:00.000Z");
    expect(tickAt(summary, 3).run?.counts).toMatchObject({ woke: 1, done: 1 });
    expect(callsTo(summary, "posthog.usage")).toBe(1);
    expect(
      run.ticks[3].calls.find((call) => call.operation.id === "posthog.usage")
        ?.fields,
    ).toMatchObject({
      customerId: "cus_nadia",
      days: 3,
    });
  });

  it("parks the customer for exactly three days: due at the instant three days after it was taken", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "the-wait-is-exactly-three-days",
    );

    expect(summary.parked).toEqual([
      {
        item: "sub_nadia",
        node: "pause",
        wait: "time",
        dueAt: new Date(
          Date.parse("2026-10-19T12:00:00.000Z") + 3 * DAY_MS,
        ).toISOString(),
      },
    ]);
    expect(callsTo(summary, "posthog.usage")).toBe(0);
    expect(effectsOf(summary)).toEqual([]);
  });

  it("saves the Stripe cursor when a run completes and reads from it next time", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "an-inactive-customer-is-nudged-exactly-three-days-later",
    );

    expect(summary.cursors).toEqual({ subs: "1760875100" });
    // The first run primed the cursor and took nothing; the next read asked from it.
    expect(sourceStep(run, 0).fields).toMatchObject({
      taken: 0,
      cursorAfter: "1760874000",
    });
    const read = (tick: number) =>
      run.ticks[tick].calls.find(
        (call) => call.operation.id === "stripe.newSubscriptions",
      );
    expect(read(0)?.fields.since).toBeUndefined();
    expect(read(1)?.fields.since).toBe("1760874000");
    expect(read(2)?.fields.since).toBe("1760875100");
  });

  it("sends nothing to a customer who has used the product, and ends them dismissed as activated", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "an-active-customer-gets-nothing",
    );

    expect(effectsOf(summary)).toEqual([]);
    expect(callsTo(summary, "email.send")).toBe(0);
    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    expect(endedWith(summary, "dismissed")).toEqual(["sub_nadia"]);
    expect(summary.statuses).toEqual({ sub_nadia: "dismissed" });
    expect(
      run.world.test.statuses.written.find(
        (entry) => entry.itemId === "sub_nadia",
      )?.reason,
    ).toBe("activated");
    // No model call was made for an email nobody will receive.
    expect(run.ticks.flatMap((tick) => tick.aiRequests)).toEqual([]);
  });

  it("nudges a subscription once even when Stripe offers it again, while it waits and after it was nudged", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "one-nudge-per-subscription",
    );

    expect(effectsOf(summary, "email.send")).toHaveLength(1);
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    // Offered while it waits: its parked row holds it.
    expect(sourceStep(run, 1).fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    // Offered after it ended: the inbox says it was handled, so it is left out.
    expect(sourceStep(run, 3).fields).toMatchObject({
      taken: 0,
      alreadyHandled: 1,
    });
    expect(tickAt(summary, 3).calls).toEqual({ "stripe.newSubscriptions": 1 });
  });

  it("never sends a second email when the tick died after the first went out: the open receipt hands the customer to a person", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-tick-that-dies-after-the-email-never-sends-a-second-one",
    );

    expect(tickAt(summary, 1).outcome).toBe("crashed");
    expect(callsTo(summary, "email.send")).toBe(1);
    // The email went out, but its receipt never closed.
    expect(effectsOf(summary, "email.send")[0].receipt).toMatchObject({
      status: "started",
    });
    expect(tickAt(summary, 2).nodes.mail).toMatchObject({
      status: "needs_check",
      error: "effect_needs_check",
    });
    expect(tickAt(summary, 2).calls["email.send"]).toBeUndefined();
    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    expect(summary.statuses).toEqual({ sub_nadia: "needs_manual" });
  });

  it("does not read a failed usage lookup as inactive: retried on each tick, never emailed, a person after the third failure", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-failed-usage-lookup-is-never-read-as-inactive",
    );

    // Three ticks, each trying the call three times before it counts as a failure.
    expect(callsTo(summary, "posthog.usage")).toBe(9);
    expect(callsTo(summary, "email.send")).toBe(0);
    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    for (const index of [1, 2, 3]) {
      expect(tickAt(summary, index).nodes.usage).toMatchObject({
        status: "failed",
        error: "provider_error",
      });
    }
    expect(tickAt(summary, 1).run?.counts.needsManual).toBeUndefined();
    expect(tickAt(summary, 2).run?.counts.needsManual).toBeUndefined();
    expect(tickAt(summary, 3).run?.counts.needsManual).toBe(1);
    expect(summary.statuses).toEqual({ sub_nadia: "needs_manual" });
    // After the handoff nothing is waiting and nothing more is read.
    expect(summary.parked).toEqual([]);
    expect(callsTo(summary, "posthog.usage")).toBe(9);
  });

  it("does not read a count it cannot read as zero: no results, an empty list and text each fail the customer at the Filter", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "an-answer-with-no-count-fails-the-item-instead-of-matching",
    );

    expect(callsTo(summary, "email.send")).toBe(0);
    expect(effectsOf(summary)).toEqual([]);
    // The same answer would fail the same way, so all three go to a person at the first look.
    expect(tickAt(summary, 1).nodes.inactive).toMatchObject({
      in: 3,
      ports: {},
      status: "failed",
      error: "expression_failed",
    });
    expect(tickAt(summary, 1).run?.counts.needsManual).toBe(3);
    expect(tickAt(summary, 2).nodes.inactive?.in ?? 0).toBe(0);
    expect(summary.statuses).toEqual({
      sub_empty: "needs_manual",
      sub_noresults: "needs_manual",
      sub_text: "needs_manual",
    });
  });

  it("tests the Filter alone on pinned customers: nothing waits, nothing is read, nothing is sent", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "testing-the-filter-on-pinned-samples",
    );

    expect(tickAt(summary, 0)).toMatchObject({
      mode: "test",
      calls: {},
      effects: [],
      nodes: { inactive: { in: 2, ports: { match: 1, otherwise: 1 } } },
    });
    expect(summary.journeys["sample-quiet"]).toEqual([
      "decision@inactive:match",
    ]);
    expect(summary.journeys["sample-busy"]).toEqual([
      "decision@inactive:otherwise",
    ]);
    expect(summary.statuses).toEqual({});
  });

  it("tells the model not to mention pricing or discounts (model-enforced: a prompt, not a code check)", async () => {
    const { run } = await scenarioRun(
      STORY,
      "an-inactive-customer-is-nudged-exactly-three-days-later",
    );

    const [asked] = run.ticks[3].aiRequests;
    expect(asked.instruction).toContain(
      "Do not mention pricing, discounts or their plan",
    );
  });
});
