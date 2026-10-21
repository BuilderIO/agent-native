import { describe, expect, it } from "vitest";

import type { InboxResult } from "../adapter.js";
import type { ThreadRef } from "../contract.js";
import { MAX_ITEM_CONTEXT_BYTES, jsonByteLength } from "../items.js";
import {
  T0,
  minutesAfter,
  normalizedItem,
  sourceResult,
} from "../testing/engine-fixtures.js";
import {
  aiPerItem,
  aiRouter,
  aiWholeList,
  ok,
  type AiResponder,
  type ScriptedOperation,
} from "../testing/fakes.js";
import {
  crashAfter,
  runStoryScript,
  type StoryRun,
  type StoryStep,
} from "../testing/story-harness.js";

// The stories that wait, and the one that loops, run end to end: the real
// graphs, the real catalog, fake providers, a fake Slack, scripted model
// answers, and a clock the script moves.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const tick = (minutes: number, label?: string): StoryStep => ({
  kind: "tick",
  at: minutesAfter(minutes),
  ...(label === undefined ? {} : { label }),
});
const provider = (
  operation: string,
  answers: readonly ScriptedOperation[] = [],
  thenAlways?: ScriptedOperation,
): StoryStep => ({
  kind: "provider",
  operation,
  answers,
  ...(thenAlways === undefined ? {} : { thenAlways }),
});
const inbox = (
  source: "inbox-poll" | "status",
  results: readonly InboxResult[],
  thenAlways?: InboxResult,
): StoryStep => ({
  kind: "inbox",
  source,
  results,
  ...(thenAlways === undefined ? {} : { thenAlways }),
});
const offered = (
  ...items: ReturnType<typeof normalizedItem>[]
): InboxResult => ({
  ok: true,
  items,
});
const nothing = offered();
const ai = (thenAlways: AiResponder): StoryStep => ({ kind: "ai", thenAlways });
const slackReply = (
  thread: ThreadRef,
  minutes: number,
  text = "Chrome 118 on a Mac",
): StoryStep => ({
  kind: "slack",
  thread,
  at: minutesAfter(minutes),
  author: "reporter@example.test",
  text,
});

/** A Slack answer that mints a message time of its own for each call, the way Slack does. */
function slackPosts(): ScriptedOperation {
  let sent = 0;
  return (request) => {
    sent += 1;
    const ts = `1760001000.${String(sent).padStart(6, "0")}`;
    // A person addressed by email is messaged in a direct-message channel of Slack's choosing.
    const to = request.fields.to;
    const channel =
      typeof request.fields.channel === "string"
        ? request.fields.channel
        : typeof to === "string"
          ? to.includes("@")
            ? "D0DIRECT"
            : to
          : "C0UNKNOWN";
    return ok(
      {
        ok: true,
        channel,
        ts,
        threadTs:
          typeof request.fields.threadTs === "string"
            ? request.fields.threadTs
            : null,
        permalink: `https://slack.test/archives/${channel}/p${ts}`,
      },
      { externalRef: ts, url: `https://slack.test/archives/${channel}/p${ts}` },
    );
  };
}

const sentTo = (run: StoryRun, operation: string) =>
  run.world.test.operations.callsTo(operation);

const tickOf = (run: StoryRun, index: number) => {
  const found = run.ticks[index];
  if (!found) throw new Error(`No tick ${index}`);
  return found;
};

const stepIn = (run: StoryRun, tickIndex: number, nodeId: string) => {
  const step = tickOf(run, tickIndex).steps.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (!step) {
    throw new Error(
      `Tick ${tickIndex} has no "${nodeId}"; it ran ${tickOf(run, tickIndex)
        .steps.map((entry) => entry.nodeId)
        .join(", ")}`,
    );
  }
  return step;
};

const countsOf = (run: StoryRun, tickIndex: number) => {
  const result = tickOf(run, tickIndex).result;
  if (result?.kind !== "ran") {
    throw new Error(`Tick ${tickIndex} did not run: ${result?.kind}`);
  }
  return result.run.counts;
};

// ---------------------------------------------------------------------------
// Story 1: a bug report to Builder, which waits for a reply and loops twice.

const FEEDBACK: ThreadRef = {
  channelId: "C0FEEDBACK",
  threadTs: "1760000000.000100",
};
const feedbackMessage = (id: string, thread: ThreadRef = FEEDBACK) =>
  normalizedItem(id, {
    kind: "message",
    provider: "slack",
    title: `Checkout button does nothing (${id})`,
    text: "Clicking Pay does nothing.",
    author: "reporter@example.test",
    url: `https://slack.test/archives/C0FEEDBACK/${id}`,
    thread,
  });

const needsInfo = {
  clearBug: true,
  enoughContext: false,
  question: "Which browser are you using?",
  risk: "low",
  confidence: "high",
  productUxImplications: false,
  alreadyClaimed: false,
  categories: [],
  reason: "There are no steps to reproduce it yet.",
};
const clearAndSafe = { ...needsInfo, enoughContext: true };

/** The model's answers for story 1: each assessment from `assess(n)`, the rest fixed. */
function bugModel(assess: (call: number) => Record<string, unknown>) {
  let calls = 0;
  return aiRouter([
    {
      when: "Assess whether this report is a clear bug",
      respond: aiPerItem(() => assess(calls++)),
    },
    {
      when: "Ask one short question",
      respond: aiPerItem(() => ({ text: "Which browser are you using?" })),
    },
    {
      when: "Group related bugs",
      respond: (request) =>
        aiWholeList({
          groups: request.items.map((item) => {
            const assessed = item.nodes.assess as Record<string, unknown>;
            return {
              id: item.id,
              groupId: `g-${item.id}`,
              thread: item.item.thread,
              author: item.item.author,
              // A one-report group: its strictest values are the report's own.
              clearBug: assessed.clearBug,
              risk: assessed.risk,
              confidence: assessed.confidence,
              productUxImplications: assessed.productUxImplications,
              alreadyClaimed: assessed.alreadyClaimed,
              categories: assessed.categories,
            };
          }),
        })(request),
    },
    {
      when: "Summarize the bug for Builder",
      respond: aiPerItem(() => ({ prompt: "Fix the checkout button." })),
    },
  ]);
}

const bugProviders = (): StoryStep[] => [
  provider("slack.readThread", [], ok({ messages: [] })),
  provider("slack.replyInThread", [], slackPosts()),
  provider("slack.postMessage", [], slackPosts()),
  provider("factory.listItems", [], ok({ items: [] })),
  provider(
    "builder.start",
    [],
    ok(
      {
        accepted: true,
        branchName: "factory-g-m1",
        projectId: "project-1",
        url: "https://builder.test/branches/factory-g-m1",
      },
      {
        externalRef: "factory-g-m1",
        url: "https://builder.test/branches/factory-g-m1",
      },
    ),
  ),
];

describe("story 1: a bug report that waits for an answer and goes round", () => {
  it("asks, waits for the reply, reads the thread again, and hands the clear report to Builder", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        ai(bugModel((call) => (call === 0 ? needsInfo : clearAndSafe))),
        inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
        tick(0, "the report arrives"),
        tick(5),
        tick(10),
        slackReply(FEEDBACK, 12),
        tick(15, "the reply is seen"),
      ],
    });

    // The first tick asked in the thread and parked the report.
    expect(sentTo(run, "slack.replyInThread")[0].fields).toMatchObject({
      channel: "C0FEEDBACK",
      threadTs: FEEDBACK.threadTs,
      text: "Which browser are you using?",
    });
    expect(stepIn(run, 0, "waitReply").ports.parked).toEqual({
      count: 1,
      itemIds: ["m1"],
    });
    // Nothing is due between the check times, and the report is not taken again.
    expect(countsOf(run, 1)).toMatchObject({ taken: 0, woke: 0, parked: 0 });
    expect(stepIn(run, 2, "feedback").fields).toMatchObject({ taken: 0 });

    // The reply sent it back to read the thread again, and the second look cleared it.
    expect(countsOf(run, 3)).toMatchObject({ woke: 1, sentBack: 1, done: 1 });
    expect(sentTo(run, "slack.readThread")).toHaveLength(2);
    expect(stepIn(run, 3, "waitReply").ports.replied).toMatchObject({
      count: 1,
      itemIds: ["m1"],
    });
    expect(sentTo(run, "builder.start")).toHaveLength(1);
    expect(sentTo(run, "builder.start")[0].fields).toMatchObject({
      projectId: "project-1",
      branchName: "factory-g-m1",
      userEmail: "reporter@example.test",
      prompt: "Fix the checkout button.",
      // The gate's six inputs reach the start, from the group the model made.
      clearBug: true,
      productUxImplications: false,
      risk: "low",
      confidence: "high",
      alreadyClaimed: false,
      categories: [],
    });
    expect(
      sentTo(run, "slack.replyInThread").map((call) => call.fields.text),
    ).toEqual([
      "Which browser are you using?",
      "Builder has started work on m1. We will report back when it is merged.",
    ]);
    expect(run.statuses).toEqual({ m1: "automation_started" });
    expect(run.parked).toEqual([]);
    expect(run.events.m1.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["taken", "parked", "woke", "decision", "ended"]),
    );
    expect(
      run.events.m1.find(
        (event) => event.kind === "decision" && event.nodeId === "waitReply",
      ),
    ).toMatchObject({ summary: 'sent back to "thread": pass 1 of 1' });
  });

  it("gives up after two questions: the second reply leaves by Limit reached, the owner is told, and Builder is never called", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        ai(bugModel(() => needsInfo)),
        inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
        tick(0),
        slackReply(FEEDBACK, 12, "Chrome"),
        tick(15),
        slackReply(FEEDBACK, 20, "Chrome 118"),
        tick(30),
      ],
    });

    expect(sentTo(run, "slack.replyInThread")).toHaveLength(2);
    expect(stepIn(run, 2, "waitReply").ports).toMatchObject({
      replied: { count: 1 },
      limitReached: { count: 1, itemIds: ["m1"] },
    });
    expect(countsOf(run, 2)).toMatchObject({
      loopLimited: 1,
      sentBack: 0,
      needsManual: 1,
    });
    expect(sentTo(run, "slack.postMessage")).toHaveLength(1);
    expect(sentTo(run, "slack.postMessage")[0].fields).toMatchObject({
      to: "triage-owner@example.test",
      text: expect.stringContaining("Needs a person"),
    });
    expect(sentTo(run, "builder.start")).toHaveLength(0);
    expect(run.statuses).toEqual({ m1: "needs_manual" });
    expect(run.parked).toEqual([]);
  });

  it("tells the owner when nobody answers for 24 hours", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        ai(bugModel(() => needsInfo)),
        inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
        tick(0),
        tick(15),
        tick(23 * 60),
        tick(24 * 60 + 5),
      ],
    });

    expect(stepIn(run, 3, "waitReply").ports.timedOut).toMatchObject({
      count: 1,
      itemIds: ["m1"],
    });
    expect(sentTo(run, "slack.postMessage")).toHaveLength(1);
    expect(sentTo(run, "slack.replyInThread")).toHaveLength(1);
    expect(run.statuses).toEqual({ m1: "needs_manual" });
    // The thread was read at each check, so a quiet thread was never mistaken for a failed read.
    expect(run.world.test.threads.requests.length).toBeGreaterThanOrEqual(3);
  });

  it("does not ask a second question when the tick died after asking: the item goes to a person", async () => {
    const effects: string[] = [];
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        provider(
          "slack.replyInThread",
          [
            ok(
              { ok: true, channel: "C0FEEDBACK", ts: "1.1", threadTs: null },
              { externalRef: "1.1" },
            ),
            crashAfter(() => effects.push("second question")),
          ],
          slackPosts(),
        ),
        ai(bugModel(() => needsInfo)),
        inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
        tick(0),
        slackReply(FEEDBACK, 12),
        tick(15, "dies after asking again"),
        tick(20, "the next tick"),
      ],
    });

    expect(tickOf(run, 1).outcome).toBe("crashed");
    expect(effects).toEqual(["second question"]);
    // The first question, the one that died; never a third.
    expect(sentTo(run, "slack.replyInThread")).toHaveLength(2);
    expect(stepIn(run, 2, "ask")).toMatchObject({
      status: "needs_check",
      error: { code: "effect_needs_check" },
    });
    expect(run.statuses).toEqual({ m1: "needs_manual" });
    expect(run.parked).toEqual([]);
    const secondQuestion = run.receipts.find(
      (receipt) => receipt.status === "started",
    );
    expect(secondQuestion).toBeDefined();
  });

  it("takes a report a dead tick was holding only once its lease has run out", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        ai(bugModel(() => needsInfo)),
        { kind: "strandLease", itemIds: ["m2"] },
        inbox(
          "inbox-poll",
          [
            offered(
              feedbackMessage("m1"),
              feedbackMessage("m2", {
                channelId: "C0FEEDBACK",
                threadTs: "1760000000.000200",
              }),
            ),
            offered(
              feedbackMessage("m2", {
                channelId: "C0FEEDBACK",
                threadTs: "1760000000.000200",
              }),
            ),
            offered(
              feedbackMessage("m2", {
                channelId: "C0FEEDBACK",
                threadTs: "1760000000.000200",
              }),
            ),
          ],
          nothing,
        ),
        tick(0),
        tick(5),
        tick(20),
      ],
    });

    expect(stepIn(run, 0, "feedback").fields).toMatchObject({
      taken: 1,
      heldByAnotherRun: 1,
    });
    expect(stepIn(run, 1, "feedback").fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    expect(stepIn(run, 2, "feedback").fields).toMatchObject({ taken: 1 });
    expect(run.parked.map((row) => row.itemId).sort()).toEqual(["m1", "m2"]);
  });

  it("finds a parked report where it left it after the process restarts", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        ai(bugModel((call) => (call === 0 ? needsInfo : clearAndSafe))),
        inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
        tick(0),
        { kind: "restart" },
        slackReply(FEEDBACK, 12),
        tick(15),
      ],
    });

    expect(run.statuses).toEqual({ m1: "automation_started" });
    expect(countsOf(run, 1)).toMatchObject({ woke: 1, sentBack: 1 });
    expect(sentTo(run, "builder.start")).toHaveLength(1);
  });

  it("walks the whole story dry without asking, waiting, or writing a row", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: [
        ...bugProviders(),
        ai(bugModel(() => needsInfo)),
        inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
        { kind: "tick", at: T0, mode: "dry", label: "dry run" },
      ],
    });

    expect(sentTo(run, "slack.replyInThread")).toHaveLength(0);
    expect(stepIn(run, 0, "waitReply").fields).toMatchObject({ wouldPark: 1 });
    expect(run.parked).toEqual([]);
    expect(run.statuses).toEqual({});
  });
});

/** A Slack thread of `count` messages, about a quarter of a kilobyte each. */
const longThread = (count: number) => ({
  messages: Array.from({ length: count }, (_, index) => ({
    ts: `1760000000.${String(index).padStart(6, "0")}`,
    user: index % 2 === 0 ? "reporter@example.test" : "support@example.test",
    text: `message ${index}: ${"the checkout button stays grey after the card is entered. ".repeat(3)}`,
  })),
});

describe("story 1 with a long Slack thread, parked at its Wait", () => {
  const BIG = longThread(60);
  const risky = { ...clearAndSafe, risk: "high", reason: needsInfo.reason };

  const withThread = (...steps: StoryStep[]): StoryStep[] => [
    ...bugProviders(),
    provider("slack.readThread", [], ok(BIG)),
    inbox("inbox-poll", [offered(feedbackMessage("m1"))], nothing),
    ...steps,
  ];

  it("is about 15 KB of thread, so the whole item could never have been parked", () => {
    expect(jsonByteLength(BIG)).toBeGreaterThan(14_000);
    expect(jsonByteLength(BIG)).toBeGreaterThan(MAX_ITEM_CONTEXT_BYTES);
  });

  it("parks with what the nodes after the Wait read and not the thread, and fits", async () => {
    const run = await runStoryScript("bug-report-to-builder", {
      steps: withThread(ai(bugModel(() => needsInfo)), tick(0)),
    });

    expect(countsOf(run, 0)).toMatchObject({ parked: 1, itemFailures: 0 });
    const [parked] = run.parked;
    const stored = parked.context as {
      nodes: Record<string, unknown>;
      kept: string[];
    };
    expect(Object.keys(stored.nodes).sort()).toEqual(["ask", "assess"]);
    expect(stored.kept).toEqual(
      expect.arrayContaining(["item", "nodes.ask", "nodes.assess"]),
    );
    const parkedBytes = jsonByteLength(parked.context);
    const wholeBytes = jsonByteLength({
      ...parked.context,
      nodes: { ...stored.nodes, thread: BIG },
    });
    expect(parkedBytes).toBeLessThan(MAX_ITEM_CONTEXT_BYTES);
    expect(wholeBytes).toBeGreaterThan(MAX_ITEM_CONTEXT_BYTES);
    expect(wholeBytes).toBeGreaterThan(parkedBytes * 5);
  });

  it("tells the owner exactly what a run that never parked tells them, after a restart and a day without a reply", async () => {
    const never = await runStoryScript("bug-report-to-builder", {
      steps: withThread(ai(bugModel(() => risky)), tick(0)),
    });
    const parked = await runStoryScript("bug-report-to-builder", {
      steps: withThread(
        ai(bugModel(() => needsInfo)),
        tick(0),
        { kind: "restart" },
        tick(15),
        tick(24 * 60 + 5, "a day on"),
      ),
    });

    expect(sentTo(never, "slack.postMessage")).toHaveLength(1);
    expect(sentTo(parked, "slack.postMessage")).toHaveLength(1);
    expect(sentTo(parked, "slack.postMessage")[0].fields).toEqual(
      sentTo(never, "slack.postMessage")[0].fields,
    );
    expect(parked.statuses).toEqual(never.statuses);
    expect(parked.statuses).toEqual({ m1: "needs_manual" });
    expect(parked.parked).toEqual([]);
  });

  it("hands the clear report to Builder exactly as a run that never parked does, after a restart and a reply", async () => {
    const never = await runStoryScript("bug-report-to-builder", {
      steps: withThread(ai(bugModel(() => clearAndSafe)), tick(0)),
    });
    const parked = await runStoryScript("bug-report-to-builder", {
      steps: withThread(
        ai(bugModel((call) => (call === 0 ? needsInfo : clearAndSafe))),
        tick(0),
        { kind: "restart" },
        slackReply(FEEDBACK, 12),
        tick(15, "the reply is seen"),
      ),
    });

    expect(countsOf(parked, 1)).toMatchObject({
      woke: 1,
      sentBack: 1,
      done: 1,
      itemFailures: 0,
    });
    expect(sentTo(never, "builder.start")).toHaveLength(1);
    expect(sentTo(parked, "builder.start").map((call) => call.fields)).toEqual(
      sentTo(never, "builder.start").map((call) => call.fields),
    );
    // The last thing said in the thread is the same; the first thing, the question, is the parked run's own.
    expect(
      sentTo(parked, "slack.replyInThread")
        .map((call) => call.fields.text)
        .slice(-1),
    ).toEqual(
      sentTo(never, "slack.replyInThread").map((call) => call.fields.text),
    );
    expect(parked.statuses).toEqual(never.statuses);
    // What the later model turns were shown matches too: the item's own fields, and the thread, read again.
    const shown = (run: StoryRun, instruction: string) => {
      const asked = run.world.test.ai.requests.filter((request) =>
        request.instruction.includes(instruction),
      );
      return asked[asked.length - 1]?.items.map((item) => ({
        item: item.item,
        thread: (item.nodes as Record<string, unknown>).thread,
      }));
    };
    for (const instruction of [
      "Assess whether this report is a clear bug",
      "Group related bugs",
      "Summarize the bug for Builder",
    ]) {
      expect(shown(parked, instruction)).toEqual(shown(never, instruction));
    }
    expect(sentTo(parked, "slack.readThread")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Story 2: Builder to merge. Nothing waits; each tick re-checks and releases.

const reportThread = (id: string): ThreadRef => ({
  channelId: "C0FEEDBACK",
  threadTs: `1760000000.${id === "r1" ? "000100" : "000200"}`,
});
const report = (id: string) =>
  normalizedItem(id, {
    kind: "message",
    provider: "slack",
    title: `Report ${id}`,
    thread: reportThread(id),
    extras: {
      builderTaskId: "task-1",
      projectId: "project-1",
      branchName: "factory-g1",
      repository: "example-org/example-repo",
    },
  });
const REPORTS = offered(report("r1"), report("r2"));
const PR_URL = "https://github.test/example-org/example-repo/pull/42";

const mergeProviders = (gate: ScriptedOperation): StoryStep[] => [
  provider("slack.replyInThread", [], slackPosts()),
  provider("slack.postMessage", [], slackPosts()),
  provider(
    "builder.followUp",
    [],
    ok({ accepted: true }, { externalRef: "factory-g1" }),
  ),
  provider("factory.mergeGate", [], gate),
  provider(
    "github.mergePullRequest",
    [],
    ok({ merged: true }, { externalRef: "sha-1", url: PR_URL }),
  ),
];

const builderState = (
  state: string,
  extra: Record<string, unknown> = {},
): ScriptedOperation => ok({ state, hasPullRequest: false, ...extra });
// What `get-factory-pull-request` reports: the checks on the head commit as counts, not a word.
const checksOf = (kind: "pending" | "failing" | "green") => ({
  coverage: "complete",
  total: 3,
  passed: kind === "green" ? 3 : 1,
  failed: kind === "failing" ? 1 : 0,
  pending: kind === "pending" ? 1 : 0,
  informational: 0,
  allPassing: kind === "green",
});
const pullRequest = (
  checks: "pending" | "failing" | "green",
  state = "open",
): ScriptedOperation =>
  ok({ state, headSha: "sha-head-1", checks: checksOf(checks), url: PR_URL });

describe("story 2: from Builder's branch to a merged pull request", () => {
  it("checks every tick, nudges a stuck task, follows the pull request, merges when green, and tells each report's own thread", async () => {
    const run = await runStoryScript("builder-to-merge", {
      steps: [
        ...mergeProviders(ok({ eligible: true })),
        inbox("status", [], REPORTS),
        provider("builder.check", [
          builderState("working"),
          builderState("stuck"),
          builderState("working", { hasPullRequest: true, prNumber: 42 }),
          builderState("working", { hasPullRequest: true, prNumber: 42 }),
        ]),
        provider("github.readPullRequest", [
          pullRequest("pending"),
          pullRequest("green"),
        ]),
        tick(0, "working, no pull request yet"),
        tick(5, "stuck: nudge once"),
        tick(10, "pull request opened, checks pending"),
        tick(15, "green: merge"),
      ],
    });

    // One check a tick for the two reports, and only the stuck tick nudged.
    expect(sentTo(run, "builder.check")).toHaveLength(4);
    expect(sentTo(run, "builder.followUp")).toHaveLength(1);
    expect(countsOf(run, 0)).toMatchObject({ released: 1, done: 0 });
    expect(countsOf(run, 2)).toMatchObject({ released: 1, done: 0 });
    expect(sentTo(run, "github.mergePullRequest")).toHaveLength(1);
    expect(sentTo(run, "github.mergePullRequest")[0].fields).toMatchObject({
      repo: "example-org/example-repo",
      number: 42,
    });
    // Each report hears in its own thread.
    expect(
      sentTo(run, "slack.replyInThread").map((call) => [
        call.fields.channel,
        call.fields.threadTs,
        call.fields.text,
      ]),
    ).toEqual([
      [
        "C0FEEDBACK",
        reportThread("r1").threadTs,
        `${PR_URL} is merged, r1 is resolved.`,
      ],
      [
        "C0FEEDBACK",
        reportThread("r2").threadTs,
        `${PR_URL} is merged, r2 is resolved.`,
      ],
    ]);
    expect(run.statuses).toEqual({ r1: "merged", r2: "merged" });
  });

  it("does not merge when the gate refuses, tells the triage owner, and hands both reports to a person", async () => {
    const run = await runStoryScript("builder-to-merge", {
      steps: [
        ...mergeProviders(
          ok({
            eligible: false,
            reasons: ["touches a migration"],
            reasonText: "touches a migration",
          }),
        ),
        inbox("status", [], REPORTS),
        provider("builder.check", [
          builderState("working", { hasPullRequest: true, prNumber: 42 }),
        ]),
        provider("github.readPullRequest", [pullRequest("green")]),
        tick(0),
      ],
    });

    expect(sentTo(run, "github.mergePullRequest")).toHaveLength(0);
    expect(sentTo(run, "slack.postMessage")).toHaveLength(1);
    expect(sentTo(run, "slack.postMessage")[0].fields).toMatchObject({
      to: "triage-owner@example.test",
      text: `${PR_URL} may not merge by itself: touches a migration Needs a person.`,
    });
    expect(run.statuses).toEqual({ r1: "needs_manual", r2: "needs_manual" });
  });
});

// ---------------------------------------------------------------------------
// Story 9: a nudge three days after someone subscribes.

const subscription = (id: string) =>
  normalizedItem(id, {
    kind: "lead",
    provider: "stripe",
    title: "new@customer.test",
    author: "new@customer.test",
    extras: {
      customerId: "cus_1",
      customerEmail: "new@customer.test",
      subscriptionId: id,
    },
  });

const nudgeProviders = (usage: ScriptedOperation): StoryStep[] => [
  provider(
    "stripe.newSubscriptions",
    [sourceResult([subscription("s1")])],
    sourceResult([]),
  ),
  provider("posthog.usage", [], usage),
  provider("email.send", [], ok(null, { externalRef: "msg-1" })),
  provider("slack.postMessage", [], slackPosts()),
  ai(
    aiRouter([
      {
        when: "friendly nudge",
        respond: aiPerItem(() => ({
          body: "Try creating your first project.",
        })),
      },
    ]),
  ),
];

describe("story 9: the activation nudge after three days", () => {
  it("waits three days, finds the customer inactive, emails them and tells the account owner", async () => {
    const run = await runStoryScript("activation-nudge", {
      steps: [
        ...nudgeProviders(ok({ results: [[1]] })),
        tick(0, "subscribed"),
        tick(15),
        tick(30),
        tick(60),
        tick((3 * DAY) / MINUTE, "three days later"),
      ],
    });

    expect(tickOf(run, 1).outcome).toBe("nothing_due");
    expect(tickOf(run, 2).outcome).toBe("nothing_due");
    expect(tickOf(run, 3).outcome).toBe("ran");
    // Only the run that did something is on record.
    expect(
      (
        await run.world
          .store()
          .listRuns(run.world.test.scope, { workflowId: run.workflowId })
      ).items,
    ).toHaveLength(3);
    expect(countsOf(run, 4)).toMatchObject({ woke: 1, done: 1 });
    expect(sentTo(run, "posthog.usage")[0].fields).toMatchObject({
      customerId: "cus_1",
      days: 3,
    });
    expect(sentTo(run, "email.send")).toHaveLength(1);
    expect(sentTo(run, "email.send")[0].fields).toMatchObject({
      to: "new@customer.test",
      subject: "Getting started with new@customer.test",
      body: "Try creating your first project.",
    });
    expect(sentTo(run, "slack.postMessage")[0].fields).toMatchObject({
      to: "account-owner@example.test",
    });
    expect(run.statuses).toEqual({ s1: "resolved" });
    expect(run.parked).toEqual([]);
  });

  it("sends nothing to a customer who started using the product in the meantime", async () => {
    const run = await runStoryScript("activation-nudge", {
      steps: [
        ...nudgeProviders(ok({ results: [[12]] })),
        tick(0),
        tick((3 * DAY) / MINUTE),
      ],
    });

    expect(sentTo(run, "email.send")).toHaveLength(0);
    expect(sentTo(run, "slack.postMessage")).toHaveLength(0);
    expect(run.statuses).toEqual({ s1: "dismissed" });
    expect(
      run.world.test.statuses.written.find((entry) => entry.itemId === "s1")
        ?.reason,
    ).toBe("activated");
  });

  it("never reads a failed usage lookup as 'inactive': it retries, and hands the customer to a person after the third failure, with no email", async () => {
    const run = await runStoryScript("activation-nudge", {
      steps: [
        ...nudgeProviders({
          ok: false,
          code: "provider_error",
          message: "PostHog is down",
          retryable: true,
          sideEffect: "none",
        }),
        tick(0),
        tick((3 * DAY) / MINUTE),
        tick((3 * DAY) / MINUTE + 15),
        tick((3 * DAY) / MINUTE + 30),
      ],
    });

    expect(stepIn(run, 1, "usage").status).toBe("failed");
    // Three ticks, each trying the call three times before it counts as a failure.
    expect(sentTo(run, "posthog.usage")).toHaveLength(9);
    expect(sentTo(run, "email.send")).toHaveLength(0);
    expect(run.statuses).toEqual({ s1: "needs_manual" });
    expect(run.parked).toEqual([]);
  });

  it("hands the customer to a person at once when PostHog refuses the lookup outright, with no email", async () => {
    const run = await runStoryScript("activation-nudge", {
      steps: [
        ...nudgeProviders({
          ok: false,
          code: "provider_error",
          message: "PostHog said the query is invalid",
          retryable: false,
          sideEffect: "none",
        }),
        tick(0),
        tick((3 * DAY) / MINUTE),
      ],
    });

    expect(stepIn(run, 1, "usage").status).toBe("failed");
    expect(sentTo(run, "posthog.usage")).toHaveLength(1);
    expect(sentTo(run, "email.send")).toHaveLength(0);
    expect(run.statuses).toEqual({ s1: "needs_manual" });
    expect(run.parked).toEqual([]);
  });

  it("collapses the ticks missed while the scheduler was down into one run", async () => {
    const run = await runStoryScript("activation-nudge", {
      steps: [
        ...nudgeProviders(ok({ results: [[1]] })),
        tick(0),
        // Nothing ticked from 13:00 to 17:00; the scheduler fires once at 17:15.
        tick(5 * 60 + 15, "back up"),
        tick(5 * 60 + 30),
      ],
    });

    expect(tickOf(run, 1).outcome).toBe("ran");
    expect(stepIn(run, 1, "hourly").fields).toMatchObject({
      windowStart: T0,
      windowEnd: minutesAfter(5 * 60),
    });
    expect(tickOf(run, 2).outcome).toBe("nothing_due");
    expect(
      (
        await run.world
          .store()
          .listRuns(run.world.test.scope, { workflowId: run.workflowId })
      ).items,
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Story 10: a cloud-cost spike, parked until someone answers.

const day = (offset: number) =>
  new Date(Date.UTC(2026, 9, 11 + offset)).toISOString().slice(0, 10);
const bill = (service: string, offset: number, cost: number) =>
  normalizedItem(`${service}|${day(offset)}`, {
    kind: "spike",
    provider: "bigquery",
    title: `${service} ${day(offset)}`,
    occurredAt: `${day(offset)}T00:00:00.000Z`,
    extras: { service, cost },
  });
/** Eight days of billing: seven steady days, then yesterday. */
const billingRows = (computeYesterday: number) => [
  ...Array.from({ length: 7 }, (_, offset) => bill("compute", offset, 100)),
  bill("compute", 7, computeYesterday),
  ...Array.from({ length: 7 }, (_, offset) => bill("storage", offset, 20)),
  bill("storage", 7, 21),
];

const SEVEN_AM_LA = "2026-10-19T14:00:00.000Z";
const at7 = (minutes: number) => minutesAfter(minutes, SEVEN_AM_LA);
const tick7 = (minutes: number, label?: string): StoryStep => ({
  kind: "tick",
  at: at7(minutes),
  ...(label === undefined ? {} : { label }),
});
const OWNERS: ThreadRef = {
  channelId: "C0OWNERS",
  threadTs: "1760001000.000001",
};

const costProviders = (computeYesterday: number): StoryStep[] => [
  { kind: "clock", at: SEVEN_AM_LA },
  provider(
    "bigquery.billingQuery",
    [sourceResult(billingRows(computeYesterday))],
    sourceResult([]),
  ),
  provider(
    "github.mergedPullRequests",
    [],
    ok({ items: [{ number: 7, html_url: "https://github.test/pull/7" }] }),
  ),
  provider("slack.postMessage", [], slackPosts()),
  provider("email.send", [], ok(null, { externalRef: "msg-1" })),
  ai(
    aiRouter([
      {
        when: "about the spiking services",
        respond: aiPerItem(() => ({
          suspects: [{ link: "https://github.test/pull/7", why: "scaled up" }],
          confidence: "medium",
          message: "Compute doubled; see https://github.test/pull/7.",
        })),
      },
    ]),
  ),
];

describe("story 10: a cost spike that waits for someone to answer", () => {
  it("alerts the owners, parks the spike, looks again every 15 minutes, and finishes when someone replies", async () => {
    const run = await runStoryScript("cloud-cost-spike", {
      start: SEVEN_AM_LA,
      steps: [
        ...costProviders(200),
        tick7(0, "07:00"),
        tick7(15),
        tick7(30),
        {
          kind: "slack",
          thread: OWNERS,
          at: at7(40),
          author: "owner@example.test",
          text: "Known launch",
        },
        tick7(45),
      ],
    });

    expect(sentTo(run, "slack.postMessage")).toHaveLength(1);
    expect(sentTo(run, "slack.postMessage")[0].fields).toMatchObject({
      to: "C0OWNERS",
      text: "Compute doubled; see https://github.test/pull/7.",
    });
    expect(sentTo(run, "email.send")).toHaveLength(1);
    // Parked after the alert: the spike, a list item, not a row of the inbox.
    expect(stepIn(run, 0, "waitReply").ports.parked.count).toBe(1);
    const [spikeId] = stepIn(run, 0, "waitReply").ports.parked.itemIds;
    expect(spikeId).toMatch(/^list:spikes:/);
    // Between the daily runs, only the parked spike makes a tick do anything.
    expect(tickOf(run, 1).result).toMatchObject({
      kind: "ran",
      passes: { trigger: false, resumed: 1 },
    });
    expect(tickOf(run, 1).steps.map((step) => step.nodeId)).not.toContain(
      "billing",
    );
    expect(
      run.world.test.threads.requests.map((request) => request.thread),
    ).toEqual([OWNERS, OWNERS, OWNERS]);
    // The reply ended it; nothing was escalated.
    expect(stepIn(run, 3, "waitReply").ports.replied.count).toBe(1);
    expect(sentTo(run, "slack.postMessage")).toHaveLength(1);
    expect(run.parked).toEqual([]);
  });

  it("escalates once, after four hours of silence", async () => {
    const run = await runStoryScript("cloud-cost-spike", {
      start: SEVEN_AM_LA,
      steps: [
        ...costProviders(200),
        tick7(0),
        tick7(2 * 60),
        tick7(4 * 60 + 10),
      ],
    });

    expect(stepIn(run, 2, "waitReply").ports.timedOut.count).toBe(1);
    expect(
      sentTo(run, "slack.postMessage").map((call) => call.fields.to),
    ).toEqual(["C0OWNERS", "escalation@example.test"]);
    expect(run.parked).toEqual([]);
  });

  it("says nothing on a quiet day, and still records the run", async () => {
    const run = await runStoryScript("cloud-cost-spike", {
      start: SEVEN_AM_LA,
      steps: [...costProviders(101), tick7(0), tick7(15), tick7(30)],
    });

    expect(sentTo(run, "slack.postMessage")).toHaveLength(0);
    expect(sentTo(run, "email.send")).toHaveLength(0);
    expect(sentTo(run, "github.mergedPullRequests")).toHaveLength(0);
    // The empty list a Combine emits was held back by the filter, and ended as "no spikes".
    expect(stepIn(run, 0, "anySpikes").ports).toMatchObject({
      match: { count: 0 },
      otherwise: { count: 1 },
    });
    expect(tickOf(run, 0).outcome).toBe("ran");
    expect(countsOf(run, 0)).toMatchObject({ parked: 0 });
    // The next two ticks are only the 15-minute checks, and nothing is waiting.
    expect(tickOf(run, 1).outcome).toBe("nothing_due");
    expect(tickOf(run, 2).outcome).toBe("nothing_due");
  });
});

// ---------------------------------------------------------------------------
// Story 7: an incident that waits for an answer and then for a status.

describe("story 7: an incident, an acknowledgement, and then a condition", () => {
  it("pages, waits for an answer, waits for the issue to resolve, and drafts the postmortem", async () => {
    const issue = normalizedItem("i1", {
      kind: "error",
      provider: "sentry",
      title: "TypeError in checkout",
      extras: {},
    });
    const page: StoryStep[] = [
      provider("slack.postMessage", [], slackPosts()),
      provider("email.send", [], ok(null, { externalRef: "msg-1" })),
      provider(
        "sentry.issueStatus",
        [ok({ status: "unresolved" }), ok({ status: "unresolved" })],
        ok({ status: "resolved" }),
      ),
      provider("sentry.issueEvents", [], ok({ events: [{ id: "e1" }] })),
      provider(
        "notion.createPage",
        [],
        ok(
          { id: "page-1", url: "https://notion.test/page-1" },
          { externalRef: "page-1", url: "https://notion.test/page-1" },
        ),
      ),
      ai(
        aiRouter([
          {
            when: "Summarize the incident",
            respond: aiPerItem(() => ({
              severity: "high",
              summary: "Checkout throws.",
              suspectedArea: "checkout",
            })),
          },
          {
            when: "Write a postmortem",
            respond: aiPerItem(() => ({
              title: "Checkout outage",
              summary: "Checkout threw for an hour.",
              timeline: [],
              impact: "Some orders failed.",
              causes: "A bad deploy.",
              followUps: [],
              body: "Checkout threw for an hour. Event e1 shows the first failure.",
            })),
          },
        ]),
      ),
      inbox("inbox-poll", [offered(issue)], nothing),
    ];
    const run = await runStoryScript("incident-to-postmortem", {
      steps: [
        ...page,
        tick(0, "paged"),
        {
          kind: "slack",
          thread: { channelId: "D0DIRECT", threadTs: "1760001000.000001" },
          at: minutesAfter(5),
          author: "oncall@example.test",
          text: "Looking",
        },
        tick(15, "acknowledged: now wait for the fix"),
        tick(30, "still unresolved"),
        tick(45, "still unresolved"),
        tick(60, "resolved"),
      ],
    });

    expect(stepIn(run, 0, "ack").ports.parked.count).toBe(1);
    expect(stepIn(run, 1, "ack").ports.replied.count).toBe(1);
    // Acknowledged, it parks again, at the next Wait, on the condition.
    expect(stepIn(run, 1, "resolved").ports.parked.count).toBe(1);
    expect(sentTo(run, "sentry.issueStatus")).toHaveLength(3);
    expect(stepIn(run, 4, "resolved").ports.met.count).toBe(1);
    expect(sentTo(run, "notion.createPage")).toHaveLength(1);
    expect(sentTo(run, "notion.createPage")[0].fields).toMatchObject({
      title: "[Draft] Checkout outage",
    });
    expect(run.statuses).toEqual({ i1: "resolved" });
    expect(run.parked).toEqual([]);
  });
});
