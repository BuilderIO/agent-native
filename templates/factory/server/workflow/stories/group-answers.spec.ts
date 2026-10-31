import { describe, expect, it } from "vitest";

import type { AiItemOutcome, AiTurnRequest, AiTurnResult } from "../adapter.js";
import { STORY_GRAPHS } from "../story-graphs.fixture.js";
import {
  compileScenario,
  summarizeRun,
  withModelAnswer,
  type ScenarioSummary,
  type StoryScenario,
} from "../testing/story-data.js";
import { runStoryScript, type StoryStep } from "../testing/story-harness.js";
import { callsTo, effectsOf } from "./proof-kit.js";
import { STORIES } from "./registry.js";

// The grouping step of story 1 may say which reports belong together and what
// the strictest gate values of each group are. Everything else about a report
// (its title, thread, author, text) is already known to the host, so nothing a
// model writes can change it. These specs hand the step answers a real model
// has given or could give, and read what the reporters' threads and Builder
// were then told.

const STORY = "bug-report-to-builder";
const graph = STORY_GRAPHS[STORY];
const story = STORIES[STORY];
const groupNode = graph.nodes.find((node) => node.id === "group");
if (groupNode?.kind !== "ai") throw new Error("Story 1 has no group node.");
const GROUP_INSTRUCTION = groupNode.settings.instruction;

const THREADS = {
  m1: { channelId: "C0FEEDBACK", threadTs: "1760000000.000100" },
  m2: { channelId: "C0FEEDBACK", threadTs: "1760000000.000200" },
  m3: { channelId: "C0FEEDBACK", threadTs: "1760000000.000300" },
};
const STARTED = (id: string) =>
  `Builder has started work on ${id}. We will report back when it is merged.`;

type Fields = Record<string, unknown>;

const gate = {
  clearBug: true,
  risk: "low",
  confidence: "high",
  productUxImplications: false,
  alreadyClaimed: false,
  categories: [],
  reason: "Same defect.",
};
const entry = (groupName: string, extra: Fields = {}): Fields => ({
  groupName,
  ...gate,
  ...extra,
});

/** The three reports of the story's `threeReports` offer: m1 and m2 are one defect, m3 another. */
const related = (): Record<string, Fields> => ({
  m1: entry("pay-button"),
  m2: entry("pay-button"),
  m3: entry("csv-export"),
});

const answered = (
  entries: readonly (readonly [string, Fields])[],
): AiTurnResult => ({
  ok: true,
  mode: "perItem",
  usage: { modelCalls: 1 },
  results: entries.map(
    ([itemId, fields]): AiItemOutcome => ({ itemId, ok: true, fields }),
  ),
});

/** One entry per item the request holds, from `fields`; an item with none gets no entry. */
const forItems =
  (fields: Record<string, Fields>) =>
  (request: AiTurnRequest): AiTurnResult =>
    answered(
      request.items.flatMap((item): [string, Fields][] => {
        const answer = fields[item.id];
        return answer === undefined ? [] : [[item.id, answer]];
      }),
    );

const scenario: StoryScenario = {
  description: "Three reports reach the grouping step.",
  steps: [
    { kind: "serve", operation: "slack.readThread", recording: "reportOnly" },
    { kind: "serve", operation: "slack.replyInThread", recording: "posted" },
    { kind: "serve", operation: "slack.postMessage", recording: "posted" },
    { kind: "serve", operation: "factory.listItems", recording: "none" },
    { kind: "serve", operation: "builder.start", recording: "accepted" },
    { kind: "ai", node: "startBuilder", recording: "prompt" },
    { kind: "ai", node: "assess", recording: "clear" },
    { kind: "offer", source: "feedback", recording: "nothing" },
    { kind: "offer", source: "feedback", recording: "threeReports", calls: 1 },
  ],
};

/** Runs the scenario with `answer` as the model's whole say in the grouping step; ticks at the minutes named. */
async function runWith(
  answer: (request: AiTurnRequest) => AiTurnResult,
  minutes: readonly number[] = [0],
) {
  const { start, steps } = compileScenario(graph, scenario, story.fixtures);
  const ticks: StoryStep[] = minutes.map((minute) => ({
    kind: "tick",
    label: `+${minute} minutes`,
    at: new Date(Date.parse(start) + minute * 60_000).toISOString(),
  }));
  const run = await runStoryScript(STORY, {
    start,
    steps: [...withModelAnswer(steps, GROUP_INSTRUCTION, answer), ...ticks],
  });
  return { run, summary: await summarizeRun(run, graph) };
}

const told = (summary: ScenarioSummary) =>
  effectsOf(summary, "slack.replyInThread").map((effect) => [
    effect.item,
    effect.fields.channel,
    effect.fields.threadTs,
    effect.fields.text,
  ]);

const errorsOf = (
  run: Awaited<ReturnType<typeof runWith>>["run"],
  item: string,
) =>
  (run.events[item] ?? [])
    .filter((event) => event.kind === "error")
    .map((event) => event.summary);

describe("what a model says in the grouping step cannot change what the host knows about a report", () => {
  it("starts each group on the first report's branch and tells every reporter in their own thread, with the model's good answer", async () => {
    const { summary } = await runWith(forItems(related()));

    expect(
      effectsOf(summary, "builder.start").map((start) => [
        start.fields.branchName,
        start.fields.userEmail,
      ]),
    ).toEqual([
      ["factory-m1", "reporter-1@example.test"],
      ["factory-m3", "reporter-3@example.test"],
    ]);
    expect(told(summary)).toEqual([
      ["m1", THREADS.m1.channelId, THREADS.m1.threadTs, STARTED("m1")],
      ["m2", THREADS.m2.channelId, THREADS.m2.threadTs, STARTED("m2")],
      ["m3", THREADS.m3.channelId, THREADS.m3.threadTs, STARTED("m3")],
    ]);
  });

  it("ignores a thread written as text, a rewritten title and author, and a gate nested under another key, when the declared fields are there", async () => {
    const mangled = (id: keyof typeof THREADS) => ({
      thread: `${THREADS[id].channelId}:${THREADS[id].threadTs}`,
      title: "A title the model made up",
      author: "somebody-else@example.test",
      id: "not-the-id",
      builderGate: { clearBug: false, risk: "high" },
    });
    const { summary, run } = await runWith(
      forItems({
        m1: entry("pay-button", mangled("m1")),
        m2: entry("pay-button", mangled("m2")),
        m3: entry("csv-export", mangled("m3")),
      }),
    );

    // What the reporters' threads and Builder were told is what the reports hold, not what the model wrote.
    expect(told(summary)).toEqual([
      ["m1", THREADS.m1.channelId, THREADS.m1.threadTs, STARTED("m1")],
      ["m2", THREADS.m2.channelId, THREADS.m2.threadTs, STARTED("m2")],
      ["m3", THREADS.m3.channelId, THREADS.m3.threadTs, STARTED("m3")],
    ]);
    expect(
      effectsOf(summary, "builder.start").map((start) => start.fields),
    ).toMatchObject([
      {
        branchName: "factory-m1",
        userEmail: "reporter-1@example.test",
        clearBug: true,
        risk: "low",
      },
      {
        branchName: "factory-m3",
        userEmail: "reporter-3@example.test",
        clearBug: true,
        risk: "low",
      },
    ]);
    expect(summary.statuses).toEqual({
      m1: "automation_started",
      m2: "automation_started",
      m3: "automation_started",
    });
    // The model that writes each task is shown the report as the host holds it, not as the grouping answer spelled it.
    expect(
      run.ticks
        .flatMap((tick) => tick.aiRequests)
        .flatMap((request) =>
          request.items
            .filter((item) => item.id.startsWith("group:"))
            .map((item) => item.item),
        ),
    ).toEqual([
      expect.objectContaining({
        title: "Checkout button does nothing",
        author: "reporter-1@example.test",
        thread: THREADS.m1,
      }),
      expect.objectContaining({
        title: "Export to CSV downloads an empty file",
        author: "reporter-3@example.test",
        thread: THREADS.m3,
      }),
    ]);
  });

  it.each([
    [
      "a gate nested under another key and no flat gate",
      { groupName: "pay-button", builderGate: gate, reason: "r" },
      '"clearBug" is missing',
    ],
    [
      "a flat gate field of the wrong kind",
      entry("pay-button", { clearBug: "yes" }),
      '"clearBug" must be true or false',
    ],
    [
      "a gate left out of the answer",
      { groupName: "pay-button", reason: "r" },
      '"clearBug" is missing',
    ],
    ["no entry for the report at all", null, "returned nothing for this item"],
  ] as const)(
    "fails the report, loudly and by name, when the model answers it with %s, and starts nothing for it",
    async (_what, m1, message) => {
      const answers: Record<string, Fields> = related();
      if (m1 === null) delete answers.m1;
      else answers.m1 = m1;
      const { summary, run } = await runWith(forItems(answers), [0, 6, 17]);

      // The first tick sets m1 aside for a retry; the answer never improves, so the third failure hands it to a person.
      expect(errorsOf(run, "m1")).toHaveLength(3);
      expect(errorsOf(run, "m1")[0]).toContain("ai_invalid_output");
      expect(errorsOf(run, "m1")[0]).toContain(message);
      expect(summary.statuses.m1).toBe("needs_manual");
      expect((summary.journeys.m1 ?? []).slice(-1)).toEqual([
        "ended@group:needsManual",
      ]);
      // m2 and m3 went on without it: m2 now leads a group of its own, and m1 was neither started nor told.
      expect(
        effectsOf(summary, "builder.start").map(
          (start) => start.fields.branchName,
        ),
      ).toEqual(["factory-m2", "factory-m3"]);
      expect(told(summary).map(([item]) => item)).toEqual(["m2", "m3"]);
      expect(summary.statuses).toMatchObject({
        m2: "automation_started",
        m3: "automation_started",
      });
    },
  );

  it.each([
    [
      "names a report that was not given",
      (request: AiTurnRequest) =>
        answered([
          ...request.items.map((item): [string, Fields] => [
            item.id,
            entry("pay-button"),
          ]),
          ["m9", entry("pay-button", { reason: "A report nobody sent." })],
        ]),
      'it names "m9", which was not given',
    ],
    [
      "answers one report twice",
      (request: AiTurnRequest) =>
        answered([
          ...request.items.map((item): [string, Fields] => [
            item.id,
            entry("pay-button"),
          ]),
          ["m1", entry("csv-export", { reason: "A second opinion." })],
        ]),
      'it answers "m1" more than once',
    ],
  ])(
    "uses none of an answer that %s, so no report is started, told or handed off on it",
    async (_what, answer, message) => {
      const { summary, run } = await runWith(answer, [0, 6, 17]);

      for (const item of ["m1", "m2", "m3"]) {
        expect(errorsOf(run, item)[0]).toContain("ai_invalid_output");
        expect(errorsOf(run, item)[0]).toContain(message);
        expect(summary.statuses[item]).toBe("needs_manual");
      }
      expect(callsTo(summary, "builder.start")).toBe(0);
      expect(callsTo(summary, "slack.replyInThread")).toBe(0);
    },
  );
});
