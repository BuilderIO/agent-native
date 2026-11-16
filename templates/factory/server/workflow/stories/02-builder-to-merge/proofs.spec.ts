import { describe, expect, it } from "vitest";

import { STORY_GRAPHS } from "../../story-graphs.fixture.js";
import { runScenario, type ScenarioSummary } from "../../testing/story-data.js";
import type { StoryRun } from "../../testing/story-harness.js";
import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "builder-to-merge";
const PR = "https://github.example.test/example-org/example-repo/pull/7";
const R1_THREAD = "1760000000.000100";
const R2_THREAD = "1760000000.000200";

const scenario = (name: string) => scenarioRun(STORY, name);

/** Every time the model was asked to judge a pull request's Verified notes. */
const judgeTurns = (summary: ScenarioSummary) =>
  summary.ticks
    .flatMap((tick) => tick.ai)
    .filter((turn) => turn.node === "judge");

/** What a tick did at one node, or a loud failure naming the nodes it did reach. */
function nodeAt(summary: ScenarioSummary, index: number, node: string) {
  const { nodes } = tickAt(summary, index);
  const found = nodes[node];
  if (found === undefined) {
    throw new Error(
      `Tick ${index} never reached "${node}"; it reached ${Object.keys(nodes).join(", ") || "nothing"}.`,
    );
  }
  return found;
}

/** The judge's turn on a tick, and the one pull request it was asked about. */
function judgeRequestAt(run: StoryRun, index: number) {
  const turn = run.ticks[index]?.aiRequests[0];
  const item = turn?.items[0];
  if (turn === undefined || item === undefined) {
    throw new Error(`Tick ${index} asked the model nothing.`);
  }
  return { turn, item };
}

/** Every scenario in which the judge does not say verified, and so nothing may merge. */
const HELD_BY_THE_JUDGE = [
  "a-green-pull-request-the-judge-is-unsure-about-is-held-for-a-person",
  "a-pull-request-whose-evidence-is-only-a-screenshot-is-held-for-a-person",
  "a-judge-that-cannot-sign-in-holds-the-pull-request",
  "a-judge-that-keeps-timing-out-holds-the-pull-request-after-three-tries",
  "a-judge-answer-outside-its-schema-holds-the-pull-request",
];

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
    // A person can tell which report it is and click through to Builder's task.
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "alert",
        fields: expect.objectContaining({
          to: "triage-owner@example.test",
          text: 'Builder is stuck on "Checkout button does nothing" (agent_waiting_for_input). Task: https://builder.example.test/branches/factory-m1',
        }),
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

  it("waits out cancelled checks without a follow-up, a gate or a merge, because cancelled is neither a failure nor green", async () => {
    const { summary } = await scenario(
      "cancelled-checks-wait-without-a-fix-or-a-merge",
    );

    for (const index of [0, 1]) {
      expect(nodeAt(summary, index, "ci").ports).toEqual({
        "route:cancelled": 1,
      });
      expect(tickAt(summary, index).effects).toEqual([]);
    }
    expect(callsTo(summary, "builder.followUp")).toBe(0);
    expect(callsTo(summary, "factory.mergeGate")).toBe(0);
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
  });

  it("sends Builder back for the real failures only when cancelled runs sit beside them", async () => {
    const { run, summary } = await scenario(
      "a-failing-pull-request-with-cancelled-checks-is-sent-back-for-the-failures-only",
    );

    expect(nodeAt(summary, 0, "ci").ports).toEqual({ "route:failing": 1 });
    const followUps = effectsOf(summary, "builder.followUp");
    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.fields.userMessage).toContain("Content parity");
    expect(followUps[0]?.fields.userMessage).not.toContain("Design core");
    // The model is shown 3 failures and 33 cancelled runs, and told to name the failures only.
    const request = run.ticks[0]?.aiRequests[0];
    expect(request?.items[0]?.nodes.readPr).toMatchObject({
      checks: { failed: 3, cancelled: 33, allPassing: false },
    });
    expect(request?.instruction).toContain("`failed`");
    expect(request?.instruction).toContain("`cancelled`");
    expect(tickAt(summary, 1).calls["builder.followUp"]).toBeUndefined();
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
  });

  it("merges a green, eligible pull request once and tells each report's own thread once", async () => {
    const { summary } = await scenario(
      "a-green-pull-request-is-merged-and-every-thread-is-told-once",
    );

    expect(callsTo(summary, "factory.mergeGate")).toBe(1);
    // The judge looked once, at the whole task, and its verified is what let the merge through.
    expect(judgeTurns(summary)).toHaveLength(1);
    expect(nodeAt(summary, 0, "judged").ports).toEqual({ match: 1 });
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
      [
        "r1",
        R1_THREAD,
        `${PR} is merged, "Checkout button does nothing" is resolved.`,
      ],
      [
        "r2",
        R2_THREAD,
        `${PR} is merged, "Pay button dead on checkout" is resolved.`,
      ],
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
    // The gate comes first: a pull request it holds is never put to the judge.
    expect(judgeTurns(summary)).toEqual([]);
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
    expect(judgeTurns(summary)).toEqual([]);
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

  it("holds a green pull request whose description has no Verified section for a person, says no_verification_evidence's reason, and does not repeat it", async () => {
    const { summary } = await scenario(
      "a-green-pull-request-without-evidence-is-held-for-a-person",
    );

    // The rule (a Verified heading with text or media under it) is proved in
    // server/lib/factory-merge-gate.spec.ts and pull-request-evidence.spec.ts; here the gate's answer reaches a person.
    expect(callsTo(summary, "factory.mergeGate")).toBe(1);
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(judgeTurns(summary)).toEqual([]);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "refused",
        fields: expect.objectContaining({
          to: "triage-owner@example.test",
          text: expect.stringContaining("no `### Verified` section"),
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

  it("shows the judge what was reported, the pull request's title, its Verified notes and its checks, one pull request per call, and lets it answer only verified or unsure", async () => {
    const { run } = await scenario(
      "a-green-pull-request-is-merged-and-every-thread-is-told-once",
    );

    const { turn, item } = judgeRequestAt(run, 0);
    expect(turn).toMatchObject({
      mode: "perItem",
      tools: [],
      resultSchemaFields: {
        verdict: { type: "enum", enum: ["verified", "unsure"] },
        reason: { type: "string" },
      },
    });
    expect(turn.items).toHaveLength(1);
    expect(item.item).toMatchObject({
      title: "Checkout button does nothing",
      text: "When I click Pay on the checkout page nothing happens and no order is created.",
      reports: [
        { title: "Checkout button does nothing" },
        { title: "Pay button dead on checkout" },
      ],
    });
    expect(item.nodes.readPr).toMatchObject({
      title: "Fix the checkout Pay button",
      // oracle-change: the recorded read now has a real pull request's checks (34 passed beside 33 skipped), not 3 passing and nothing else
      checks: {
        passed: 34,
        failed: 0,
        cancelled: 0,
        informational: 33,
        allPassing: true,
      },
      verification: {
        present: true,
        hasMedia: true,
        excerpt: expect.stringContaining("checkout spec fails without the fix"),
      },
    });
  });

  it("holds a pull request the judge is unsure about, tells the triage owner its reason once, and never merges", async () => {
    const { summary } = await scenario(
      "a-green-pull-request-the-judge-is-unsure-about-is-held-for-a-person",
    );

    // Only the judge's verified reaches the merge; the gate had already said yes, and the judge cannot undo that or add to it.
    expect(callsTo(summary, "factory.mergeGate")).toBe(1);
    expect(judgeTurns(summary)).toHaveLength(1);
    expect(nodeAt(summary, 0, "judged").ports).toEqual({ otherwise: 1 });
    expect(tickAt(summary, 0).nodes.merge).toBeUndefined();
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "judgeHold",
        fields: expect.objectContaining({
          to: "triage-owner@example.test",
          text: expect.stringContaining(
            "The notes say it was tested but do not name a test or say what the result was.",
          ),
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

  it("holds a pull request whose only evidence is a screenshot: the judge is given no text to read and says it cannot see the image", async () => {
    const { run, summary } = await scenario(
      "a-pull-request-whose-evidence-is-only-a-screenshot-is-held-for-a-person",
    );

    expect(judgeRequestAt(run, 0).item.nodes.readPr).toMatchObject({
      verification: { present: true, hasMedia: true, excerpt: "" },
    });
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "judgeHold",
        fields: expect.objectContaining({
          text: expect.stringContaining("screenshots, which I cannot see"),
        }),
      }),
    ]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
  });

  it("never reads a judge that cannot sign in as verified: the failure leaves by the judge's error output, the triage owner is told its typed code, and a person sees it in Needs you", async () => {
    const { run, summary } = await scenario(
      "a-judge-that-cannot-sign-in-holds-the-pull-request",
    );

    // No credential is not worth retrying, so the first failure takes the error output.
    expect(nodeAt(summary, 0, "judge").ports).toEqual({ error: 1 });
    expect(tickAt(summary, 0).run?.counts).toMatchObject({
      errorRouted: 1,
      needsManual: 1,
    });
    expect(tickAt(summary, 0).run?.counts.itemFailures).toBeUndefined();
    expect(tickAt(summary, 0).nodes.judged).toBeUndefined();
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "judgeFailed",
        fields: expect.objectContaining({
          to: "triage-owner@example.test",
          text: expect.stringContaining(
            "could not run (credential_missing): The AI turn failed (credentials): No usable model credential",
          ),
        }),
      }),
    ]);
    expect(effectsOf(summary)).toHaveLength(1);
    expect(judgeTurns(summary)).toHaveLength(1);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    const reasons = Object.values(run.events)
      .flat()
      .filter((event) => event.kind === "ended")
      .map((event) => event.summary);
    expect(reasons).toHaveLength(3);
    for (const reason of reasons) {
      expect(reason).toContain("credential_missing");
      expect(reason).toContain("No usable model credential");
    }
    expect(tickAt(summary, 1)).toMatchObject({ calls: {}, effects: [] });
  });

  it("retries a judge that keeps timing out twice, five and then ten minutes on, tells the triage owner once after the third try, and never merges", async () => {
    const { summary } = await scenario(
      "a-judge-that-keeps-timing-out-holds-the-pull-request-after-three-tries",
    );

    expect(judgeTurns(summary)).toHaveLength(3);
    // The first two failures are parked for a retry and send no alert; only the last takes the error output.
    for (const index of [0, 1]) {
      expect(tickAt(summary, index).nodes.judge).toMatchObject({
        status: "failed",
        error: "provider_error",
      });
      expect(tickAt(summary, index).effects).toEqual([]);
    }
    expect(nodeAt(summary, 2, "judge").ports).toEqual({ error: 1 });
    for (const index of [0, 1, 2]) {
      expect(tickAt(summary, index).nodes.judged).toBeUndefined();
    }
    // The reports are offered again while the task waits for its retry, and are not taken a second time.
    expect(tickAt(summary, 1).run?.counts.taken).toBeUndefined();
    expect(tickAt(summary, 2).run?.counts).toMatchObject({
      needsManual: 1,
      errorRouted: 1,
    });
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary).map((effect) => effect.node)).toEqual([
      "judgeFailed",
    ]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    expect(summary.parked).toEqual([]);
    expect(tickAt(summary, 3)).toMatchObject({ calls: {}, effects: [] });
  });

  it("never reads an answer outside the declared fields as verified: a verdict that is neither word, verified with no reason, and a wrong-case verdict each fail the task, and the last takes the error output", async () => {
    const { summary } = await scenario(
      "a-judge-answer-outside-its-schema-holds-the-pull-request",
    );

    expect(judgeTurns(summary)).toHaveLength(3);
    for (const index of [0, 1]) {
      expect(tickAt(summary, index).nodes.judge).toMatchObject({
        status: "failed",
        error: "ai_invalid_output",
      });
    }
    expect(nodeAt(summary, 2, "judge").ports).toEqual({ error: 1 });
    for (const index of [0, 1, 2]) {
      expect(tickAt(summary, index).nodes.judged).toBeUndefined();
    }
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toEqual([
      expect.objectContaining({
        node: "judgeFailed",
        fields: expect.objectContaining({
          text: expect.stringContaining("could not run (ai_invalid_output)"),
        }),
      }),
    ]);
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
  });

  it("says in a dry run that it would tell the triage owner a judge failed, and sends nothing", async () => {
    const { summary } = await scenario(
      "a-dry-run-with-a-failing-judge-routes-the-alert-and-sends-nothing",
    );

    expect(tickAt(summary, 0)).toMatchObject({ mode: "dry", effects: [] });
    expect(nodeAt(summary, 0, "judge").ports).toEqual({ error: 1 });
    expect(nodeAt(summary, 0, "judgeFailed").ports).toEqual({ out: 1 });
    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    expect(callsTo(summary, "github.mergePullRequest")).toBe(0);
    expect(summary.statuses).toEqual({});
  });

  it("reaches the merge on nothing but a verified from the judge", async () => {
    for (const name of HELD_BY_THE_JUDGE) {
      const { summary } = await scenario(name);

      expect(callsTo(summary, "factory.mergeGate"), name).toBeGreaterThan(0);
      expect(callsTo(summary, "github.mergePullRequest"), name).toBe(0);
      expect(effectsOf(summary, "github.mergePullRequest"), name).toEqual([]);
      expect(effectsOf(summary, "slack.replyInThread"), name).toEqual([]);
      for (const tick of summary.ticks) {
        expect(tick.nodes.merge, name).toBeUndefined();
        expect(tick.nodes.reports, name).toBeUndefined();
      }
      expect(Object.values(summary.statuses), name).toEqual([
        "needs_manual",
        "needs_manual",
      ]);
    }
    const merged = await scenario(
      "a-green-pull-request-is-merged-and-every-thread-is-told-once",
    );
    expect(callsTo(merged.summary, "github.mergePullRequest")).toBe(1);
  });

  it("pauses a task the run's model-call cap leaves unjudged, merges nothing for it, and judges it on the next run", async () => {
    // The cap is a setting of the workflow that no scenario can set, so this one proof runs the story with a cap of 1.
    const story = STORIES["builder-to-merge"];
    const green =
      story.script.scenarios[
        "a-green-pull-request-is-merged-and-every-thread-is-told-once"
      ];
    expect(green).toBeDefined();
    const steps = (green?.steps ?? []).map((step) =>
      step.kind === "offer" && step.recording === "twoReports"
        ? { ...step, recording: "twoTasks" }
        : step,
    );
    const graph = STORY_GRAPHS["builder-to-merge"];
    STORY_GRAPHS["builder-to-merge"] = {
      ...graph,
      settings: { ...graph.settings, modelCallCap: 1 },
    };
    let summary: ScenarioSummary;
    try {
      ({ summary } = await runScenario(
        "builder-to-merge",
        { description: "Two green tasks, one model call.", steps },
        story.fixtures,
      ));
    } finally {
      STORY_GRAPHS["builder-to-merge"] = graph;
    }

    // Tick 0: one task is judged and merged; the other is set aside before the judge, not merged and not failed.
    expect(tickAt(summary, 0).run).toMatchObject({
      status: "paused",
      error: "budget_paused",
      counts: { modelCalls: 1, setAside: 1 },
    });
    expect(nodeAt(summary, 0, "judge")).toMatchObject({
      in: 2,
      ports: { out: 1 },
      error: "ai_cap_reached",
    });
    expect(nodeAt(summary, 0, "merge").in).toBe(1);
    expect(tickAt(summary, 0).calls["github.mergePullRequest"]).toBe(1);
    // Tick 1: the set-aside task is judged on its own and then merged.
    expect(judgeTurns(summary)).toHaveLength(2);
    expect(nodeAt(summary, 1, "judged").ports).toEqual({ match: 1 });
    expect(tickAt(summary, 1).calls["github.mergePullRequest"]).toBe(1);
    expect(summary.statuses).toEqual({ r1: "merged", r3: "merged" });
  });

  it("puts the judge between the gate and the merge, with one way into the merge and a model that sees one pull request at a time", () => {
    const graph = STORY_GRAPHS["builder-to-merge"];
    const into = (node: string) =>
      graph.edges
        .filter((edge) => edge.to.node === node)
        .map((edge) => `${edge.from.node}:${edge.from.port}`);

    expect(into("judge")).toEqual(["eligible:match"]);
    expect(into("judged")).toEqual(["judge:out"]);
    expect(into("merge")).toEqual(["judged:match"]);
    expect(into("judgeHold")).toEqual(["judged:otherwise"]);
    // A judge that fails never reaches `judged`: it leaves by its error output, to a person, never to the merge.
    expect(into("judgeFailed")).toEqual(["judge:error"]);
    expect(into("judgeFailedEnd")).toEqual(["judgeFailed:out"]);
    const judged = graph.nodes.find((node) => node.id === "judged");
    expect(
      judged?.kind === "filter" ? judged.settings.rules : undefined,
    ).toEqual([
      { left: "nodes.judge.verdict", op: "equals", right: "verified" },
    ]);
    const judge = graph.nodes.find((node) => node.id === "judge");
    expect(judge?.kind === "ai" ? judge.settings : undefined).toMatchObject({
      mode: "perItem",
      batchSize: 1,
      onError: "route",
      tools: [],
      result: {
        verdict: { type: "enum", enum: ["verified", "unsure"] },
        reason: { type: "string" },
      },
    });
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
    // The notice for a task that ended names the report and links Builder's task, with why it ended.
    expect(
      effectsOf(ended.summary, "slack.postMessage").map(
        (effect) => effect.fields.text,
      ),
    ).toEqual([
      `Builder's task for "Checkout button does nothing" ended without a pull request (branch_deleted). Task: https://builder.example.test/branches/factory-m1. Needs a person.`,
      `Builder's task for "Export to CSV downloads an empty file" ended without a pull request (merged_then_archived). Task: https://builder.example.test/branches/factory-m3. Needs a person.`,
    ]);
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
    // A dry run runs the model like any read, so the judge answers; the merge it clears still writes nothing.
    expect(judgeTurns(summary)).toHaveLength(1);
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

  it("tests the judge on a pinned sample: the model is asked about that sample only, and nothing is read, sent or merged", async () => {
    const { summary } = await scenario(
      "a-test-of-the-judge-runs-only-the-judge-and-merges-nothing",
    );

    expect(tickAt(summary, 0)).toMatchObject({
      mode: "test",
      calls: {},
      effects: [],
    });
    expect(Object.keys(tickAt(summary, 0).nodes)).toEqual(["judge"]);
    expect(judgeTurns(summary)).toEqual([
      { node: "judge", mode: "perItem", items: ["sample-task"] },
    ]);
    expect(summary.statuses).toEqual({});
  });

  it("hands a task to a person after six fix rounds, one follow-up per head commit", async () => {
    const { summary } = await scenario(
      "a-pull-request-that-fails-on-every-new-head-goes-to-a-person-after-six-rounds",
    );

    expect(effectsOf(summary, "builder.followUp")).toHaveLength(6);
    expect(
      effectsOf(summary, "slack.postMessage").map((effect) => effect.node),
    ).toEqual(["capAlert"]);
    const [alert] = effectsOf(summary, "slack.postMessage");
    expect(alert?.fields.text).toBe(
      '"Checkout button does nothing": https://github.example.test/example-org/example-repo/pull/7 still fails after six rounds with Builder. Task: https://builder.example.test/branches/factory-m1. Needs a person.',
    );
    expect(summary.statuses).toEqual({
      r1: "needs_manual",
      r2: "needs_manual",
    });
    expect(effectsOf(summary, "github.mergePullRequest")).toEqual([]);
  });
  it("names the report by what it says in every notice to the triage owner, not by who wrote it", async () => {
    for (const name of [
      "a-green-pull-request-that-fails-the-merge-gate-is-not-merged",
      "a-green-pull-request-the-judge-is-unsure-about-is-held-for-a-person",
      "a-closed-pull-request-goes-to-a-person",
      "a-stuck-task-is-nudged-twice-then-escalated",
    ]) {
      const { summary } = await scenario(name);
      const notices = effectsOf(summary, "slack.postMessage");
      expect(notices.length, name).toBeGreaterThan(0);
      for (const notice of notices) {
        expect(String(notice.fields.text), name).toContain(
          '"Checkout button does nothing"',
        );
      }
    }
  });
});
