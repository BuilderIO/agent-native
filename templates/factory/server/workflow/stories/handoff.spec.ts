import { describe, expect, it } from "vitest";

import type { NormalizedItem } from "../items.js";
import { runScenario, type StoryFixtures } from "../testing/story-data.js";
import { scenarioRun } from "./proof-kit.js";
import { STORIES } from "./registry.js";

// Stories 1 and 8 hand work to Builder and story 2 follows it. These specs run
// the first story, build story 2's input from what it did, and run story 2 on
// it, so a rename in either graph (a branch, a project, a status) breaks the
// link here instead of in a deployment.
//
// The handed-off End of each story records the Builder task on the item
// (`builderTaskId`, `projectId`, `branchName`, `repository`), and story 2's
// status Source reads those four fields from the row. The rows below carry
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

    // Which branch each report went to: the group the model put it in.
    const group = STORIES["bug-report-to-builder"].fixtures.ai.group?.related;
    const groups =
      group !== undefined && "wholeList" in group
        ? (group.wholeList.groups as { id: string; groupId: string }[])
        : [];
    const reports = offeredItems(
      STORIES["bug-report-to-builder"].fixtures.inbox.feedback,
    );
    const handedOff = Object.entries(summary.statuses)
      .filter(([, status]) => status === "automation_started")
      .map(([id]) => id);
    expect(handedOff.sort()).toEqual(["m1", "m2", "m3"]);
    const rows = handedOff.map((id) => {
      const report = reports.find((candidate) => candidate.id === id);
      const groupId = groups.find((entry) => entry.id === id)?.groupId;
      if (report === undefined || groupId === undefined) {
        throw new Error(`Report ${id} has no recorded group.`);
      }
      const recorded = summary.recorded?.[id];
      // The End wrote the branch of the group the report was put in.
      expect(recorded?.branchName).toBe(`factory-${groupId}`);
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
});
