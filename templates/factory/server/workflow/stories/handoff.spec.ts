import { describe, expect, it } from "vitest";

import type { NormalizedItem } from "../items.js";
import { runScenario, type StoryFixtures } from "../testing/story-data.js";
import { effectsOf, scenarioRun } from "./proof-kit.js";
import { STORIES } from "./registry.js";

// Stories 1 and 8 hand work to Builder and story 2 follows it. These specs run
// the first story, build story 2's input from what it did, and run story 2 on
// it, so a rename in either graph (a branch, a project, a status) breaks the
// link here instead of in a deployment.
//
// The handed-off End of each story records the Builder task on the item
// (`builderTaskId`, `projectId`, `branchName`, `builderUrl`, `repository`), and
// story 2's status Source reads those five fields from the row. The rows below carry
// what the first story's End really recorded, nothing written by hand.

function offeredItems(
  recordings: Record<string, object> | undefined,
): NormalizedItem[] {
  return Object.values(recordings ?? {}).flatMap((recording) =>
    "items" in recording && Array.isArray(recording.items)
      ? (recording.items as NormalizedItem[])
      : [],
  );
}

/** The row a handed-off item holds: what it came in with, then what the End recorded and the status it set. */
function handedOffRow(
  item: NormalizedItem,
  recorded: Record<string, unknown> | undefined,
): NormalizedItem {
  if (recorded === undefined) {
    throw new Error(`Item ${item.id} was handed off with nothing recorded.`);
  }
  return {
    ...item,
    extras: { ...item.extras, ...recorded, status: "automation_started" },
  };
}

async function storyTwoChecks(items: NormalizedItem[]) {
  const story = STORIES["builder-to-merge"];
  const fixtures: StoryFixtures = {
    ...story.fixtures,
    inbox: { inFlight: { handedOff: { items } } },
  };
  const { run } = await runScenario(
    "builder-to-merge",
    {
      description: "Story 2 follows what another story handed to Builder.",
      steps: [
        { kind: "serve", operation: "builder.check", recording: "working" },
        { kind: "offer", source: "inFlight", recording: "handedOff" },
        { kind: "tick", label: "checks the handed-off tasks" },
      ],
    },
    fixtures,
  );
  return run.ticks[0].calls
    .filter((call) => call.operation.id === "builder.check")
    .map((call) => ({ ...call.fields }));
}

describe("a task handed to Builder is followed by story 2", () => {
  it("checks, once each, the very branches story 1 started for its reports", async () => {
    const { summary } = await scenarioRun(
      "bug-report-to-builder",
      "two-related-reports-become-one-task",
    );
    const started = summary.ticks
      .flatMap((tick) => tick.effects)
      .filter((effect) => effect.operation === "builder.start")
      .map((effect) => ({
        projectId: effect.fields.projectId,
        branchName: effect.fields.branchName,
      }));
    expect(started).toHaveLength(2);

    // Which branch each report went to: the group the model put it in, named after the first report of that group.
    const group = STORIES["bug-report-to-builder"].fixtures.ai.group?.related;
    const groupNames =
      group !== undefined && "perItem" in group
        ? Object.fromEntries(
            Object.entries(group.perItem).map(([id, answer]) => [
              id,
              "groupName" in answer ? String(answer.groupName) : undefined,
            ]),
          )
        : {};
    const reports = offeredItems(
      STORIES["bug-report-to-builder"].fixtures.inbox.feedback,
    );
    const handedOff = Object.entries(summary.statuses)
      .filter(([, status]) => status === "automation_started")
      .map(([id]) => id);
    expect(handedOff.sort()).toEqual(["m1", "m2", "m3"]);
    const rows = handedOff.map((id) => {
      const report = reports.find((candidate) => candidate.id === id);
      const groupName = groupNames[id];
      const leader = reports.find(
        (candidate) => groupNames[candidate.id] === groupName,
      );
      if (report === undefined || leader === undefined) {
        throw new Error(`Report ${id} has no recorded group.`);
      }
      const recorded = summary.recorded?.[id];
      // The End wrote the branch of the group the report was put in, which is its first report's, never the model's label.
      expect(recorded?.branchName).toBe(`factory-${leader.id}`);
      return handedOffRow(report, recorded);
    });

    const checks = await storyTwoChecks(rows);

    // Three reports, two tasks: story 2 reads each task once, on the branch story 1 started.
    expect(checks.map((fields) => fields.branchName).sort()).toEqual(
      started.map((entry) => entry.branchName).sort(),
    );
    expect(checks).toHaveLength(2);
    for (const fields of checks) {
      expect(started).toContainEqual({
        projectId: fields.projectId,
        branchName: fields.branchName,
      });
    }
  });

  it("checks the branch story 8 started for a safe fix, though no chat thread is behind it", async () => {
    const { summary } = await scenarioRun(
      "security-alert-to-safe-fix",
      "each-alert-lands-where-the-story-says",
    );
    expect(summary.statuses["alert-101"]).toBe("automation_started");
    const start = summary.ticks
      .flatMap((tick) => tick.effects)
      .find((effect) => effect.operation === "builder.start");
    expect(start).toMatchObject({ item: "alert-101" });

    const alert = Object.values(
      STORIES["security-alert-to-safe-fix"].fixtures.provider[
        "github.listSecurityAlerts"
      ] ?? {},
    )
      .flatMap((recording) =>
        "items" in recording && Array.isArray(recording.items)
          ? (recording.items as NormalizedItem[])
          : [],
      )
      .find((item) => item.id === "alert-101");
    if (alert === undefined)
      throw new Error("alert-101 is not in the fixtures.");

    const checks = await storyTwoChecks([
      handedOffRow(alert, summary.recorded?.["alert-101"]),
    ]);

    expect(checks).toEqual([
      {
        projectId: start?.fields.projectId,
        branchName: start?.fields.branchName,
      },
    ]);
  });

  // Builder keeps a branch name of its own, so what story 2 checks is the name the start returned, never the one asked for.
  it("checks the branch Builder returned for story 1's report, not the one story 1 asked for", async () => {
    const { summary } = await scenarioRun(
      "bug-report-to-builder",
      "a-start-on-a-branch-builder-renamed-is-announced-and-tracked-under-the-returned-name",
    );
    const start = summary.ticks
      .flatMap((tick) => tick.effects)
      .find((effect) => effect.operation === "builder.start");
    const returned = start?.receipt?.externalRef;
    expect(returned).toBeDefined();
    expect(returned).not.toBe(start?.fields.branchName);

    const report = offeredItems(
      STORIES["bug-report-to-builder"].fixtures.inbox.feedback,
    ).find((candidate) => candidate.id === "m1");
    if (report === undefined) throw new Error("m1 is not in the fixtures.");

    expect(
      await storyTwoChecks([handedOffRow(report, summary.recorded?.m1)]),
    ).toEqual([{ projectId: "project-1", branchName: returned }]);
  });

  it("checks the branch Builder returned for story 8's alert, not the one story 8 asked for", async () => {
    const story = STORIES["security-alert-to-safe-fix"];
    const returned = "calm-harbor-x7k2q9";
    const scenario =
      story.script.scenarios["each-alert-lands-where-the-story-says"];
    if (scenario === undefined) throw new Error("Story 8 lost its scenario.");
    const { summary } = await runScenario(
      "security-alert-to-safe-fix",
      scenario,
      {
        ...story.fixtures,
        provider: {
          ...story.fixtures.provider,
          "builder.start": {
            ...story.fixtures.provider["builder.start"],
            // Builder's own name for the branch, as it answers every real start.
            accepted: {
              ok: true,
              output: {
                accepted: true,
                branchName: returned,
                projectId: "{fields.projectId}",
                url: `https://builder.example.test/p/{fields.projectId}/${returned}`,
              },
              externalRef: returned,
            },
          },
        },
      },
    );
    const start = summary.ticks
      .flatMap((tick) => tick.effects)
      .find((effect) => effect.operation === "builder.start");
    expect(start?.fields.branchName).not.toBe(returned);

    const alert = offeredItems(
      story.fixtures.provider["github.listSecurityAlerts"],
    ).find((candidate) => candidate.id === "alert-101");
    if (alert === undefined)
      throw new Error("alert-101 is not in the fixtures.");

    expect(
      await storyTwoChecks([
        handedOffRow(alert, summary.recorded?.["alert-101"]),
      ]),
    ).toEqual([{ projectId: start?.fields.projectId, branchName: returned }]);
  });
  it("tells the triage owner which report a stuck task is for, and links the task story 1 started", async () => {
    const { summary } = await scenarioRun(
      "bug-report-to-builder",
      "the-task-carries-the-reports-own-words-whatever-the-model-wrote",
    );
    const report = offeredItems(
      STORIES["bug-report-to-builder"].fixtures.inbox.feedback,
    ).find((candidate) => candidate.id === "d1");
    if (report === undefined) throw new Error("d1 is not in the fixtures.");
    const row = handedOffRow(report, summary.recorded?.d1);

    const story = STORIES["builder-to-merge"];
    const { summary: followed } = await runScenario(
      "builder-to-merge",
      {
        description:
          "A task story 1 handed off sits stuck until it is escalated.",
        steps: [
          {
            kind: "serve",
            operation: "slack.postMessage",
            recording: "posted",
          },
          {
            kind: "serve",
            operation: "builder.followUp",
            recording: "accepted",
          },
          { kind: "serve", operation: "builder.check", recording: "stuck" },
          { kind: "offer", source: "inFlight", recording: "handedOff" },
          { kind: "tick", label: "first nudge", at: "+0m" },
          { kind: "tick", label: "second nudge", at: "+5m" },
          { kind: "tick", label: "escalated", at: "+10m" },
        ],
      },
      {
        ...story.fixtures,
        inbox: { inFlight: { handedOff: { items: [row] } } },
      },
    );

    const [notice] = effectsOf(followed, "slack.postMessage");
    // The headline story 1 named the report by, and the address its start recorded.
    expect(notice?.fields.text).toBe(
      `Builder is stuck on "${report.title}" (agent_waiting_for_input). Task: https://builder.example.test/branches/factory-d1`,
    );
  });
});
