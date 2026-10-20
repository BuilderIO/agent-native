import { describe, expect, it } from "vitest";

import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";

const STORY = "builder-to-merge";
const PR = "https://github.example.test/example-org/example-repo/pull/7";
const R1_THREAD = "1760000000.000100";
const R2_THREAD = "1760000000.000200";

const scenario = (name: string) => scenarioRun(STORY, name);

describe("story 2 proofs: Builder to merge", () => {
  it("checks a task once for all its reports and leaves a working task alone", async () => {
    const { summary } = await scenario(
      "a-working-task-is-checked-once-for-its-reports-and-left-alone",
    );

    for (const index of [0, 1]) {
      const tick = tickAt(summary, index);
      expect(tick.calls).toEqual({ "builder.check": 1 });
      expect(tick.nodes.byTask).toMatchObject({ in: 2, ports: { out: 1 } });
      expect(tick.effects).toEqual([]);
    }
    expect(summary.statuses).toEqual({});
  });

  it("nudges a stuck task at most twice and then tells the triage owner and hands its reports to a person", async () => {
    const { summary } = await scenario(
      "a-stuck-task-is-nudged-twice-then-escalated",
    );

    const nudges = effectsOf(summary, "builder.followUp");
    expect(nudges).toHaveLength(2);
    expect(nudges.map((nudge) => nudge.fields.userMessage)).toEqual([
      "status? continue",
      "status? continue",
    ]);
    // The third tick escalates instead of nudging a third time, and says so to the triage owner once.
    expect(tickAt(summary, 2).calls["builder.followUp"]).toBeUndefined();
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "alert",
        fields: expect.objectContaining({ to: "triage-owner@example.test" }),
      }),
    ]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    // Once the reports are with a person nothing more is sent.
    expect(tickAt(summary, 3)).toMatchObject({ calls: {}, effects: [] });
  });

  it("sends a failing pull request back to Builder once per head commit, and never while Builder is working", async () => {
    const { summary } = await scenario(
      "a-failing-pull-request-is-sent-back-once-per-head-commit",
    );

    const followUps = effectsOf(summary, "builder.followUp");
    expect(followUps).toHaveLength(2);
    expect(followUps[0].fields.userMessage).toContain("headA");
    expect(followUps[1].fields.userMessage).toContain("headB");
    // Same head, same failure: the second tick finds the head already asked about.
    expect(tickAt(summary, 1).nodes.askedForHead.ports).toEqual({ match: 1 });
    expect(tickAt(summary, 1).calls["builder.followUp"]).toBeUndefined();
    // Builder was working when head B first failed: nothing was sent, though the checks were read and failing.
    expect(tickAt(summary, 2).nodes.ci.ports).toEqual({ "route:failing": 1 });
    expect(tickAt(summary, 2).nodes.builderIdle.ports).toEqual({
      otherwise: 1,
    });
    expect(tickAt(summary, 2).calls["builder.followUp"]).toBeUndefined();
    // A new head is asked about again, and only once.
    expect(tickAt(summary, 3).calls["builder.followUp"]).toBe(1);
    expect(tickAt(summary, 4).calls["builder.followUp"]).toBeUndefined();
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
  });

  it("waits out running checks without a follow-up, a gate or a merge", async () => {
    const { summary } = await scenario(
      "pending-checks-wait-without-a-nudge-or-a-merge",
    );

    for (const index of [0, 1]) {
      expect(tickAt(summary, index).nodes.ci.ports).toEqual({
        "route:pending": 1,
      });
      expect(tickAt(summary, index).effects).toEqual([]);
    }
    expect(callsTo(summary, "factory.mergeGate")).toBe(0);
  });

  it("merges a green, eligible pull request once and tells each report's own thread once", async () => {
    const { summary } = await scenario(
      "a-green-pull-request-is-merged-and-every-thread-is-told-once",
    );

    expect(callsTo(summary, "factory.mergeGate")).toBe(1);
    const [merge] = effectsOf(summary, "github.mergePullRequest");
    expect(merge.fields).toMatchObject({
      repo: "example-org/example-repo",
      number: 7,
    });
    expect(merge.receipt).toMatchObject({
      status: "done",
      externalRef: "merge-sha-7",
    });
    expect(
      effectsOf(summary, "slack.replyInThread").map((effect) => [
        effect.item,
        effect.fields.threadTs,
        effect.fields.text,
      ]),
    ).toEqual([
      ["r1", R1_THREAD, `${PR} is merged, r1 is resolved.`],
      ["r2", R2_THREAD, `${PR} is merged, r2 is resolved.`],
    ]);
    expect(summary.statuses).toEqual({ r1: "merged", r2: "merged" });
    expect(tickAt(summary, 1)).toMatchObject({ calls: {}, effects: [] });
  });

  it("does not merge a green pull request the gate refuses, and says why to the triage owner", async () => {
    const { summary } = await scenario(
      "a-green-pull-request-that-fails-the-merge-gate-is-not-merged",
    );

    // The gate's rules, and the merge action re-running the gate itself, are proved where they live:
    // server/lib/factory-merge-gate.spec.ts and actions/merge-factory-pull-request.spec.ts.
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "refused",
        fields: expect.objectContaining({
          to: "triage-owner@example.test",
          text: expect.stringContaining("database migration"),
        }),
      }),
    ]);
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
  });

  it("holds a green pull request with no current approval for a person, says approval_required's reason, and does not repeat it", async () => {
    const { summary } = await scenario(
      "a-green-pull-request-without-a-current-approval-is-held-for-a-person",
    );

    // The rule itself (latest review per reviewer, collaborators only, current head commit) is proved in
    // server/lib/factory-merge-approval.spec.ts and factory-merge-gate.spec.ts; here the gate's answer reaches a person.
    expect(callsTo(summary, "factory.mergeGate")).toBe(1);
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "refused",
        fields: expect.objectContaining({
          to: "triage-owner@example.test",
          text: expect.stringContaining("has approved the current head commit"),
        }),
      }),
    ]);
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    expect(tickAt(summary, 1)).toMatchObject({ calls: {}, effects: [] });
  });

  it("tells the threads of a pull request someone else merged, without merging or asking the gate", async () => {
    const { summary } = await scenario(
      "a-pull-request-merged-by-someone-else-goes-straight-to-the-threads",
    );

    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(callsTo(summary, "factory.mergeGate")).toBe(0);
    expect(effectsOf(summary, "slack.replyInThread")).toHaveLength(2);
    expect(summary.statuses).toEqual({ r1: "merged", r2: "merged" });
  });

  it("hands a closed pull request, one with no usable checks, and a task that ended with no pull request to a person, never to a merge", async () => {
    const closed = await scenario("a-closed-pull-request-goes-to-a-person");
    const bare = await scenario(
      "a-pull-request-with-no-checks-goes-to-a-person",
    );
    const ended = await scenario(
      "a-task-that-ended-without-a-pull-request-goes-to-a-person",
    );

    for (const { summary } of [closed, bare, ended]) {
      expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
      expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
      expect(effectsOf(summary, "slack.postMessage").length).toBeGreaterThan(0);
    }
    expect(closed.summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    expect(bare.summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    // Two tasks, two messages, and each task's report is handed to a person.
    expect(ended.summary.statuses).toEqual({
      r1: "needs_manual",
      r3: "needs_manual",
    });
    expect(effectsOf(ended.summary, "slack.postMessage")).toHaveLength(2);
  });

  it("never reads a task it could not read as working, and hands it to a person at once", async () => {
    const { summary } = await scenario(
      "an-unreadable-task-is-never-read-as-working",
    );

    expect(tickAt(summary, 0).nodes.check).toMatchObject({
      status: "failed",
      error: "provider_error",
    });
    expect(tickAt(summary, 0).run?.counts.needsManual).toBe(1);
    // Reading it again would fail the same way, so the ticks after do not look.
    expect(callsTo(summary, "builder.check")).toBe(1);
    expect(tickAt(summary, 1).nodes.check).toBeUndefined();
    expect(callsTo(summary, "builder.followUp")).toBe(0);
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
  });

  it("notifies every thread of a merged task exactly once, even when one reply fails", async () => {
    const { summary } = await scenario(
      "a-failed-reply-is-retried-and-the-merge-is-not-repeated",
    );

    expect(callsTo(summary, "github.mergePullRequest")).toBe(1);
    const replies = effectsOf(summary, "slack.replyInThread");
    expect(replies.map((reply) => [reply.item, reply.receipt?.status])).toEqual(
      [
        ["r1", "done"],
        // Three tries in the first tick, then the one five minutes on.
        ["r2", "failed"],
        ["r2", "failed"],
        ["r2", "failed"],
        ["r2", "done"],
      ],
    );
    // r1's thread was told in the first tick and not again in the second.
    expect(tickAt(summary, 1).effects.map((effect) => effect.item)).toEqual([
      "r2",
    ]);
    expect(summary.statuses).toEqual({ r1: "merged", r2: "merged" });
  });

  it("never sends a merge again when the first may have happened", async () => {
    const { summary } = await scenario(
      "a-merge-that-may-have-happened-is-never-repeated",
    );

    expect(callsTo(summary, "github.mergePullRequest")).toBe(1);
    expect(
      effectsOf(summary, "github.mergePullRequest")[0].receipt,
    ).toMatchObject({
      status: "started",
    });
    for (const index of [0, 1]) {
      expect(tickAt(summary, index).nodes.merge).toMatchObject({
        status: "needs_check",
        error: "effect_needs_check",
      });
    }
    expect(effectsOf(summary, "slack.replyInThread")).toEqual([]);
    expect(endedWith(summary, "needsManual").sort()).toEqual(
      expect.arrayContaining(["r1", "r2"]),
    );
  });

  it("announces a merge for a report that did not start in Slack in the findings channel, not in a thread", async () => {
    const { summary } = await scenario(
      "a-merged-fix-for-an-alert-is-announced-in-the-findings-channel",
    );

    expect(callsTo(summary, "slack.replyInThread")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "tellFindings",
        item: "a1",
        fields: expect.objectContaining({ to: "C0FINDINGS" }),
      }),
    ]);
    expect(summary.statuses).toEqual({ a1: "merged" });
  });

  it("merges nothing and tells no one in a dry run", async () => {
    const { summary } = await scenario("a-dry-run-merges-nothing");

    expect(tickAt(summary, 0)).toMatchObject({ mode: "dry", effects: [] });
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(callsTo(summary, "slack.replyInThread")).toBe(0);
    expect(summary.statuses).toEqual({});
  });

  it("runs only the node a test names, and a read in it is real", async () => {
    const { summary } = await scenario(
      "a-test-of-one-node-reads-but-writes-nothing",
    );

    expect(tickAt(summary, 0)).toMatchObject({
      mode: "test",
      calls: { "github.readPullRequest": 1 },
      effects: [],
    });
    expect(Object.keys(tickAt(summary, 0).nodes)).toEqual(["readPr"]);
  });

  it("hands a task to a person after six fix rounds, one follow-up per head commit", async () => {
    const { summary } = await scenario(
      "a-pull-request-that-fails-on-every-new-head-goes-to-a-person-after-six-rounds",
    );

    expect(effectsOf(summary, "builder.followUp")).toHaveLength(6);
    expect(
      effectsOf(summary, "slack.postMessage").map((effect) => effect.node),
    ).toEqual(["capAlert"]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    expect(effectsOf(summary, "github.mergePullRequest")).toEqual([]);
  });
});
