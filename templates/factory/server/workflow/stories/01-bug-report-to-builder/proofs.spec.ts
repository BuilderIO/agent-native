import { describe, expect, it } from "vitest";

import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";

const STORY = "bug-report-to-builder";
const M1_THREAD = { channelId: "C0FEEDBACK", threadTs: "1760000000.000100" };
const M2_THREAD = { channelId: "C0FEEDBACK", threadTs: "1760000000.000200" };
const M3_THREAD = { channelId: "C0FEEDBACK", threadTs: "1760000000.000300" };
const STARTED = (id: string) =>
  `Builder has started work on ${id}. We will report back when it is merged.`;

const scenario = (name: string) => scenarioRun(STORY, name);

/** The questions asked in a thread, in order. */
const questions = (summary: Awaited<ReturnType<typeof scenario>>["summary"]) =>
  effectsOf(summary, "slack.replyInThread")
    .filter((effect) => effect.node === "ask")
    .map((effect) => effect.fields.text);

describe("story 1 proofs: a bug report to Builder", () => {
  it("hands a clear bug to Builder on a branch named for its group, and tells the thread once", async () => {
    const { summary } = await scenario(
      "a-clear-bug-goes-to-builder-and-the-reporter-is-told",
    );

    const [start] = effectsOf(summary, "builder.start");
    expect(start.fields).toMatchObject({
      projectId: "project-1",
      branchName: "factory-m1",
      userEmail: "reporter-1@example.test",
      // The gate's six inputs reach the start, from the group the model made.
      clearBug: true,
      productUxImplications: false,
      risk: "low",
      confidence: "high",
      alreadyClaimed: false,
      categories: [],
    });
    expect(start.receipt).toMatchObject({
      status: "done",
      externalRef: "factory-m1",
    });
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([
      expect.objectContaining({
        node: "tell",
        item: "m1",
        fields: {
          channel: "C0FEEDBACK",
          threadTs: M1_THREAD.threadTs,
          text: STARTED("m1"),
        },
      }),
    ]);
    expect(summary.statuses).toEqual({ m1: "automation_started" });
  });

  it("asks a missing-info report once, parks it, wakes it on the reply, reads and assesses it again", async () => {
    const { summary, run } = await scenario(
      "missing-info-asks-waits-is-woken-and-assessed-again",
    );

    expect(questions(summary)).toEqual(["Which browser are you using?"]);
    expect(tickAt(summary, 0).nodes.waitReply.ports).toEqual({ parked: 1 });
    // Between the check times nothing is asked, read, or handed to the model.
    for (const quiet of [1, 2]) {
      expect(tickAt(summary, quiet)).toMatchObject({
        calls: {},
        ai: [],
        effects: [],
      });
    }
    const woken = tickAt(summary, 3);
    expect(woken.nodes.waitReply.ports.replied).toBe(1);
    expect(woken.run?.counts).toMatchObject({ woke: 1, sentBack: 1, done: 1 });
    // Read again, assessed again, then on to Builder.
    expect(woken.calls["slack.readThread"]).toBe(1);
    expect(woken.ai.map((turn) => turn.node)).toContain("assess");
    expect(callsTo(summary, "slack.readThread")).toBe(2);
    expect(callsTo(summary, "builder.start")).toBe(1);
    // Two replies in the window are one wake, not two.
    const wakes = run.events.m1.filter((event) => event.kind === "woke");
    expect(wakes).toHaveLength(1);
    expect(wakes[0].summary).toContain("2 replies");
    expect(summary.statuses).toEqual({ m1: "automation_started" });
    expect(summary.parked).toEqual([]);
  });

  it("gives up after two questions: the second reply is not read, the owner is told, and Builder is never called", async () => {
    const { summary } = await scenario("gives-up-after-two-questions");

    const asked = questions(summary);
    expect(asked).toHaveLength(2);
    // Enforced by the loop's cap of one send-back; that the second differs from the first is the model's instruction.
    expect(new Set(asked).size).toBe(2);
    const last = tickAt(summary, 2);
    expect(last.run?.counts).toMatchObject({ loopLimited: 1, needsManual: 1 });
    expect(last.nodes.waitReply.ports).toMatchObject({ limitReached: 1 });
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(callsTo(summary, "builder.start")).toBe(0);
    // Nothing more is asked once the owner has been told.
    expect(tickAt(summary, 3)).toMatchObject({ calls: {}, effects: [] });
    expect(summary.statuses).toEqual({ m1: "needs_manual" });
    expect(summary.parked).toEqual([]);
  });

  it("tells the owner when nobody answers for 24 hours, and not before", async () => {
    const { summary } = await scenario("nobody-answers-for-24-hours");

    for (const early of [1, 2]) {
      expect(tickAt(summary, early).run?.counts).toEqual({ stillWaiting: 1 });
      expect(tickAt(summary, early).effects).toEqual([]);
    }
    expect(tickAt(summary, 3).nodes.waitReply.ports).toEqual({ timedOut: 1 });
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(questions(summary)).toHaveLength(1);
    expect(summary.statuses).toEqual({ m1: "needs_manual" });
  });

  it("leaves a report waiting when only a bot has written in its thread", async () => {
    const { summary } = await scenario("a-bot-message-is-not-a-reply");

    // Dropping bot messages is the thread reader's job (server/workflow-host/thread-reader.spec.ts); the engine must not wake on what it is not handed.
    expect(tickAt(summary, 1).run?.counts).toEqual({ stillWaiting: 1 });
    expect(tickAt(summary, 1).nodes.waitReply).toBeUndefined();
    expect(tickAt(summary, 2).nodes.waitReply.ports.replied).toBe(1);
    expect(summary.statuses).toEqual({ m1: "automation_started" });
  });

  it("does not read a thread it could not read as a thread nobody answered", async () => {
    const { summary } = await scenario(
      "a-thread-that-cannot-be-read-is-not-an-empty-thread",
    );

    const failed = tickAt(summary, 1);
    expect(failed.nodes.waitReply).toMatchObject({
      status: "failed",
      error: "provider_error",
    });
    // The read could not be made, which is no attempt spent: the report keeps waiting.
    expect(failed.run?.counts).toEqual({ itemFailures: 1, stillWaiting: 1 });
    expect(failed.effects).toEqual([]);
    expect(tickAt(summary, 2).nodes.waitReply.ports).toEqual({ timedOut: 1 });
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
  });

  it("sends each kind of report where the story says, and none of them to Builder", async () => {
    const { summary, run } = await scenario(
      "each-route-ends-where-the-story-says",
    );

    // m1 is not a bug, m3 was claimed by a person, m2 is clear but touches payments.
    expect(summary.statuses).toEqual({
      m1: "dismissed",
      m2: "needs_manual",
      m3: "dismissed",
    });
    expect(endedWith(summary, "dismissed").sort()).toEqual(["m1", "m3"]);
    const reasonOf = (item: string) =>
      run.events[item].find((event) => event.kind === "ended")?.summary;
    expect(reasonOf("m1")).toContain("not a defect");
    expect(reasonOf("m3")).toContain("already reacted");
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        item: "m2",
        fields: expect.objectContaining({ to: "triage-owner@example.test" }),
      }),
    ]);
    // Nothing clear and safe arrived, so the grouping and the start were never reached.
    expect(callsTo(summary, "builder.start")).toBe(0);
    expect(tickAt(summary, 0).ai.map((turn) => turn.node)).toEqual(["assess"]);
    // A person's claim is also kept out at the source: the node names the reaction, and the inbox host skips claimed messages
    // (server/workflow-host/claim-reaction.spec.ts: "skips a message a person reacted to with the configured reaction").
    expect(run.world.test.inbox.requests[0].settings).toMatchObject({
      source: "inbox-poll",
      poller: "slack",
      takeLimit: 5,
      filter: { claimReaction: "eyes" },
    });
  });

  it("turns two related reports into one Builder task and tells both threads once", async () => {
    const { summary } = await scenario("two-related-reports-become-one-task");

    const starts = effectsOf(summary, "builder.start");
    // m1 and m2 share a group, so there is one start for them and one for the unrelated m3.
    expect(starts.map((start) => start.fields.branchName)).toEqual([
      "factory-m1",
      "factory-m3",
    ]);
    const told = effectsOf(summary, "slack.replyInThread");
    expect(
      told.map((effect) => [
        effect.item,
        effect.fields.channel,
        effect.fields.threadTs,
        effect.fields.text,
      ]),
    ).toEqual([
      ["m1", "C0FEEDBACK", M1_THREAD.threadTs, STARTED("m1")],
      ["m2", "C0FEEDBACK", M2_THREAD.threadTs, STARTED("m2")],
      ["m3", "C0FEEDBACK", M3_THREAD.threadTs, STARTED("m3")],
    ]);
    expect(summary.statuses).toEqual({
      m1: "automation_started",
      m2: "automation_started",
      m3: "automation_started",
    });
  });

  it("never says Builder started when the branch it names is not the one asked for", async () => {
    const { summary } = await scenario(
      "a-start-confirmed-on-another-branch-is-never-announced",
    );

    // The 202 half (a start is only answered once Builder accepted) is the executor's: server/workflow-host/builder-operations.spec.ts.
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(effectsOf(summary, "slack.postMessage")[0].fields.text).toContain(
      "factory-renamed-by-builder",
    );
    expect(summary.statuses).toEqual({ m1: "needs_manual" });
  });

  it("does not tell the reporter, and hands the report to a person at once when the gate refuses", async () => {
    const { summary } = await scenario(
      "a-refused-start-fails-the-item-and-nobody-is-told",
    );

    // The gate itself is enforced inside builder.start (server/workflow-host/builder-operations.spec.ts, "builder.start dispatch gate");
    // here the engine's side: a refusal fails the item, nothing is announced, and a person gets it now: the same start
    // would be refused again, so nothing tries it a second time.
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
    expect(tickAt(summary, 0).nodes.startBuilder).toMatchObject({
      status: "failed",
      error: "operation_not_allowed",
    });
    expect(tickAt(summary, 0).run?.counts.needsManual).toBe(1);
    expect(tickAt(summary, 1).nodes.startBuilder).toBeUndefined();
    expect(tickAt(summary, 2).nodes.startBuilder).toBeUndefined();
    expect(callsTo(summary, "builder.start")).toBe(1);
    expect(summary.statuses).toEqual({ m1: "needs_manual" });
  });

  it("never retries a start that may have happened, even when the report is offered again", async () => {
    const { summary } = await scenario(
      "a-timed-out-start-is-never-retried-blind",
    );

    // Looking the branch up before a start, and again after a timeout, is the executor's half
    // (server/workflow-host/builder-operations.spec.ts: "looks the branch up before starting, so a retry never makes a second one").
    expect(callsTo(summary, "builder.start")).toBe(1);
    expect(effectsOf(summary, "builder.start")[0].receipt).toMatchObject({
      status: "started",
    });
    expect(tickAt(summary, 0).nodes.startBuilder).toMatchObject({
      status: "needs_check",
      error: "effect_needs_check",
    });
    // Offered again, the engine finds the open receipt and goes no further.
    expect(tickAt(summary, 1).nodes.startBuilder.status).toBe("needs_check");
    expect(tickAt(summary, 1).calls["builder.start"]).toBeUndefined();
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
    expect(summary.statuses).toEqual({ m1: "needs_manual" });
  });

  it("never asks twice when the tick that asked died before it heard back", async () => {
    const { summary } = await scenario(
      "a-tick-that-dies-after-asking-never-asks-twice",
    );

    expect(tickAt(summary, 0).outcome).toBe("crashed");
    expect(callsTo(summary, "slack.replyInThread")).toBe(1);
    expect(effectsOf(summary, "slack.replyInThread")[0].receipt).toMatchObject({
      status: "started",
    });
    expect(tickAt(summary, 1).nodes.ask).toMatchObject({
      status: "needs_check",
      error: "effect_needs_check",
    });
    expect(summary.statuses).toEqual({ m1: "needs_manual" });
  });

  it("retries a failed reply without starting Builder a second time", async () => {
    const { summary } = await scenario(
      "a-failed-tell-is-retried-without-starting-builder-again",
    );

    expect(tickAt(summary, 0).nodes.tell).toMatchObject({ status: "failed" });
    expect(callsTo(summary, "builder.start")).toBe(1);
    expect(
      effectsOf(summary, "slack.replyInThread").map(
        (effect) => effect.receipt?.status,
      ),
      // Three tries in the first tick, each on a receipt of its own, then the one five minutes on.
    ).toEqual(["failed", "failed", "failed", "done"]);
    expect(tickAt(summary, 0).run?.counts.retryParked).toBe(1);
    expect(summary.statuses).toEqual({ m1: "automation_started" });
  });

  it("finds a parked report where it left it after a restart", async () => {
    const { summary } = await scenario(
      "a-parked-report-is-found-again-after-a-restart",
    );

    expect(tickAt(summary, 1).run?.counts).toMatchObject({
      woke: 1,
      sentBack: 1,
    });
    expect(callsTo(summary, "builder.start")).toBe(1);
    expect(summary.statuses).toEqual({ m1: "automation_started" });
  });

  it("does not hand the same report to Builder, or tell its thread, twice", async () => {
    const { summary } = await scenario(
      "the-same-group-offered-again-is-not-started-twice",
    );

    expect(callsTo(summary, "builder.start")).toBe(1);
    expect(callsTo(summary, "slack.replyInThread")).toBe(1);
    expect(tickAt(summary, 1).effects).toEqual([]);
    expect(summary.statuses).toEqual({ m1: "automation_started" });
  });

  it("asks nothing, parks nothing and writes no status in a dry run", async () => {
    const { summary } = await scenario(
      "a-dry-run-asks-nothing-and-parks-nothing",
    );

    expect(tickAt(summary, 0)).toMatchObject({ mode: "dry", effects: [] });
    expect(callsTo(summary, "slack.replyInThread")).toBe(0);
    expect(summary.parked).toEqual([]);
    expect(summary.statuses).toEqual({});
  });
});
