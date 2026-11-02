import { describe, expect, it } from "vitest";

import type { AiTurnRequest, AiTurnResult } from "../adapter.js";
import type { WorkflowGraph } from "../contract.js";
import { stableHash } from "../engine/bounds.js";
import { STORY_GRAPHS } from "../story-graphs.fixture.js";
import { reenable } from "../testing/make-host.js";
import {
  compileScenario,
  withModelAnswer,
  type StoryScenario,
} from "../testing/story-data.js";
import {
  runStoryScript,
  type StoryStep,
  type StoryWorld,
  type TranscriptTick,
} from "../testing/story-harness.js";
import { STORIES } from "./registry.js";

// A Builder task is started once. The only thing that stops a second one is
// the start's receipt: a done receipt for the same item at the same node is
// the answer, and Builder is not called. These specs replay the first live
// hand-off. Its start was accepted, Builder kept a branch name of its own, and
// the graph as it was first saved refused that name, so the report went to a
// person with the task already running. The graph was fixed, saved again, and
// the report requeued. That run must reach the start, find the receipt, and go
// on to tell the reporter and record the task.

const STORY = "bug-report-to-builder";
const RENAMED = "calm-harbor-x7k2q9";
const story = STORIES[STORY];

/** A report, handed to Builder under a name Builder changed, offered twice: before the fix and after the requeue. */
const scenario: StoryScenario = {
  description:
    "The hand-off the first live run made, then the same report requeued.",
  steps: [
    { kind: "serve", operation: "slack.readThread", recording: "reportOnly" },
    { kind: "serve", operation: "slack.replyInThread", recording: "posted" },
    { kind: "serve", operation: "slack.postMessage", recording: "posted" },
    { kind: "serve", operation: "factory.listItems", recording: "none" },
    { kind: "serve", operation: "builder.start", recording: "renamed" },
    { kind: "offer", source: "feedback", recording: "nothing" },
    { kind: "ai", node: "startBuilder", recording: "prompt" },
    { kind: "ai", node: "assess", recording: "clear" },
    { kind: "ai", node: "group", recording: "solo" },
    { kind: "offer", source: "feedback", recording: "m1", calls: 2 },
  ],
};

/** The story's graph with the check it had when the first live run met a renamed branch. */
function savedBeforeTheFix(): WorkflowGraph {
  const graph = structuredClone(STORY_GRAPHS[STORY]);
  const node = graph.nodes.find((entry) => entry.id === "accepted");
  if (node?.kind !== "filter")
    throw new Error("Story 1 has no accepted filter.");
  node.settings.rules = [
    {
      left: "nodes.startBuilder.externalRef",
      op: "equals",
      right: "factory-{{ item.key }}",
    },
  ];
  return graph;
}

async function saveNewVersion(
  world: StoryWorld,
  graph: WorkflowGraph,
  expectedVersion: number,
) {
  await world.store().saveWorkflowGraph(world.test.scope, {
    workflowId: STORY,
    expectedVersion,
    graph,
    source: "save",
    summary: "re-saved by the operator",
    createdBy: "owner@example.test",
  });
  await reenable(world.test, STORY);
}

async function replayLiveHandOff() {
  const { start, steps } = compileScenario(
    STORY_GRAPHS[STORY],
    scenario,
    story.fixtures,
  );
  const minutesIn = (minutes: number) =>
    new Date(Date.parse(start) + minutes * 60_000).toISOString();
  const afterFirstRun: { status?: string | undefined; told: number } = {
    told: 0,
  };
  const run = await runStoryScript(STORY, {
    start,
    steps: [
      ...steps,
      // Version 2 is the graph as it was first saved; version 1 is the fixed graph the harness seeds and never runs.
      {
        kind: "call",
        run: (world) => saveNewVersion(world, savedBeforeTheFix(), 1),
      },
      {
        kind: "tick",
        label: "the first run, before the fix",
        at: minutesIn(0),
      },
      {
        kind: "call",
        run: async (world) => {
          afterFirstRun.status = world.test.statuses.statusOf("m1");
          afterFirstRun.told = world.test.operations.callsTo(
            "slack.replyInThread",
          ).length;
          // What requeue-factory-item does to the row, and the operator's new save.
          world.test.statuses.rowStatus.set("m1", "received");
          await saveNewVersion(world, STORY_GRAPHS[STORY], 2);
        },
      },
      {
        kind: "tick",
        label: "the requeued report, after the fix",
        at: minutesIn(5),
      },
    ],
  });
  const [before, after] = run.ticks;
  if (before === undefined || after === undefined) {
    throw new Error("The script ticked twice and the run kept fewer.");
  }
  return { run, before, after, afterFirstRun };
}

const startsIn = (calls: { operation: { id: string } }[]) =>
  calls.filter((call) => call.operation.id === "builder.start");

const notTheGroupRecording = (step: StoryScenario["steps"][number]) =>
  !(step.kind === "ai" && step.node === "group");

describe("a Builder start that already has a done receipt is not made again", () => {
  it("reuses the receipt when the requeued report reaches the start again, and tells and records the returned branch", async () => {
    const { run, before, after, afterFirstRun } = await replayLiveHandOff();

    // Before the fix: Builder was started, the graph refused the name, and a person had a report nobody was told about.
    expect(startsIn(before.calls)).toHaveLength(1);
    expect(afterFirstRun).toEqual({ status: "needs_manual", told: 0 });

    // After it: the same report reached the start again and Builder was not called. This is the line that fails on a second task.
    expect(startsIn(after.calls)).toHaveLength(0);
    expect(startsIn(run.world.test.operations.calls)).toHaveLength(1);

    // The reporter was told once, and what the report holds is the branch Builder kept.
    expect(
      run.world.test.operations.callsTo("slack.replyInThread"),
    ).toHaveLength(1);
    expect(run.statuses.m1).toBe("automation_started");
    expect(run.recorded.m1).toEqual({
      builderTaskId: `project-1:${RENAMED}`,
      projectId: "project-1",
      branchName: RENAMED,
      builderUrl: `https://builder.example.test/branches/${RENAMED}`,
      repository: "example-org/example-repo",
    });
  });

  it("finds the same receipt in a new run of a new workflow version", async () => {
    const { run, before, after } = await replayLiveHandOff();

    const keysOf = (tick: typeof before) =>
      tick.steps.find((step) => step.nodeId === "startBuilder")?.receiptKeys ??
      [];
    const first = keysOf(before);
    expect(first).toHaveLength(1);
    expect(keysOf(after)).toEqual(first);
    expect(before.runId).toBeDefined();
    expect(after.runId).not.toBe(before.runId);
    expect(
      (await run.world.store().getWorkflow(run.world.test.scope, STORY))
        ?.version,
    ).toBe(3);

    // The receipt is what the second run was handed: the branch and address Builder gave, closed once.
    const receipt = run.receipts.find((entry) => first.includes(entry.key));
    expect(receipt).toMatchObject({
      status: "done",
      externalRef: RENAMED,
      url: `https://builder.example.test/branches/${RENAMED}`,
    });
    // A receipt keeps only the fields that name a thing, so `accepted` and `branchName` are not there to read on a reused start.
    expect(receipt?.output).toEqual({
      projectId: "project-1",
      status: "processing",
      url: `https://builder.example.test/branches/${RENAMED}`,
    });
  });
});

// The receipt key is the workflow, the group's item id, the step, a round and
// the members of the group. The group's item id comes from the id of the
// group's first report, never from what the model called the group, so a
// requeued report has the same key whatever the model writes next time.
describe("a requeued report keeps its group key and its receipt key, whatever the model calls the group", () => {
  const groupNode = STORY_GRAPHS[STORY].nodes.find(
    (node) => node.id === "group",
  );
  if (groupNode?.kind !== "ai") throw new Error("Story 1 has no group node.");
  const groupInstruction = groupNode.settings.instruction;

  const labels = ["pay-button", "the checkout bug", "group-zzz-9", "m1"];

  async function requeuedUnderEveryLabel() {
    let label = labels[0];
    // The report is offered again after every requeue, once for each name.
    const offered: StoryScenario = {
      ...scenario,
      steps: scenario.steps.flatMap((step): StoryScenario["steps"] =>
        step.kind === "offer" && step.recording === "m1"
          ? [{ ...step, calls: labels.length }]
          : notTheGroupRecording(step)
            ? [step]
            : [],
      ),
    };
    const { start, steps } = compileScenario(
      STORY_GRAPHS[STORY],
      offered,
      story.fixtures,
    );
    const answer = (request: AiTurnRequest): AiTurnResult => ({
      ok: true,
      mode: "perItem",
      usage: { modelCalls: 1 },
      results: request.items.map((item) => ({
        itemId: item.id,
        ok: true as const,
        fields: {
          groupName: label,
          clearBug: true,
          risk: "low",
          confidence: "high",
          productUxImplications: false,
          alreadyClaimed: false,
          categories: [],
          reason: "Only report about the Pay button.",
        },
      })),
    });
    const requeue = (next: string): StoryStep => ({
      kind: "call",
      run: (world) => {
        // What requeue-factory-item does to the row; the model names the group differently this time.
        world.test.statuses.rowStatus.set("m1", "received");
        label = next;
      },
    });
    const minutesIn = (minutes: number) =>
      new Date(Date.parse(start) + minutes * 60_000).toISOString();
    const run = await runStoryScript(STORY, {
      start,
      steps: [
        ...withModelAnswer(steps, groupInstruction, answer),
        { kind: "tick", label: `named ${labels[0]}`, at: minutesIn(0) },
        ...labels.slice(1).flatMap((next, index): StoryStep[] => [
          requeue(next),
          {
            kind: "tick",
            label: `named ${next}`,
            at: minutesIn((index + 1) * 5),
          },
        ]),
      ],
    });
    return run;
  }

  const keysOf = (tick: Pick<TranscriptTick, "steps">) =>
    tick.steps.find((step) => step.nodeId === "startBuilder")?.receiptKeys ??
    [];

  it("reaches the same start receipt on every rerun and calls Builder once", async () => {
    const run = await requeuedUnderEveryLabel();

    expect(run.ticks).toHaveLength(labels.length);
    const keys = run.ticks.map(keysOf);
    expect(keys[0]).toHaveLength(1);
    // A different key here is a second Builder task: this is the line that fails when the model's label names the group.
    for (const rerun of keys) expect(rerun).toEqual(keys[0]);
    expect(startsIn(run.world.test.operations.calls)).toHaveLength(1);
    // Builder is called on the first run and on none after it.
    expect(run.ticks.map((tick) => startsIn(tick.calls).length)).toEqual(
      labels.map((_, index) => (index === 0 ? 1 : 0)),
    );
    expect(run.statuses.m1).toBe("automation_started");
  });

  it("derives that key from the report's own id, so the label is not in it", async () => {
    const run = await requeuedUnderEveryLabel();

    const [firstTick] = run.ticks.slice(0, 1);
    expect(
      (firstTick ? keysOf(firstTick) : []).map((key) =>
        key.split(":").map(decodeURIComponent),
      ),
    ).toEqual([
      [
        STORY,
        `group:byGroup:${stableHash("m1")}`,
        "startBuilder",
        "0",
        expect.any(String),
      ],
    ]);
    // Every name the model gave comes out as the same group, called after the report that leads it.
    for (const tick of run.ticks) {
      const grouped = tick.steps.find((step) => step.nodeId === "byGroup");
      expect(grouped?.ports.out?.itemIds).toEqual([
        `group:byGroup:${stableHash("m1")}`,
      ]);
    }
  });

  it("tells the reporter once, however often the report is requeued", async () => {
    const run = await requeuedUnderEveryLabel();

    expect(
      run.world.test.operations.callsTo("slack.replyInThread"),
    ).toHaveLength(1);
  });
});
