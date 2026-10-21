import { describe, expect, it } from "vitest";

import { ok } from "./fakes.js";
import {
  SimulatedCrash,
  crashAfter,
  runStoryScript,
  type StoryScript,
} from "./story-harness.js";

const DIGEST: StoryScript = {
  steps: [
    {
      kind: "inbox",
      source: "status",
      results: [],
      thenAlways: { ok: true, items: [] },
    },
    { kind: "tick", label: "first" },
    { kind: "tick", at: "2026-10-19T12:05:00.000Z" },
  ],
};

describe("runStoryScript", () => {
  it("runs a script against the real story graph and reports each tick, the run it recorded, and its steps", async () => {
    const run = await runStoryScript("builder-to-merge", DIGEST);

    expect(run.workflowId).toBe("builder-to-merge");
    expect(run.ticks.map((tick) => tick.outcome)).toEqual(["ran", "ran"]);
    expect(run.ticks[0]).toMatchObject({ label: "first", runId: "run-1" });
    expect(run.ticks[0].steps.map((step) => step.nodeId)).toContain("inFlight");
    expect(run.parked).toEqual([]);
    expect(run.statuses).toEqual({});
  });

  it("gives the same transcript every time it runs", async () => {
    const strip = (transcript: Awaited<ReturnType<typeof runStoryScript>>) => {
      const { world: _world, ...data } = transcript;
      return data;
    };

    expect(strip(await runStoryScript("builder-to-merge", DIGEST))).toEqual(
      strip(await runStoryScript("builder-to-merge", DIGEST)),
    );
  });

  it("records a tick the process died in, with what it had done, and keeps going", async () => {
    const effects: string[] = [];
    const run = await runStoryScript("builder-to-merge", {
      steps: [
        {
          kind: "inbox",
          source: "status",
          results: [
            {
              ok: true,
              items: [
                {
                  id: "r1",
                  externalId: "r1",
                  kind: "message",
                  provider: "slack",
                  title: "Report",
                  occurredAt: "2026-10-19T11:00:00.000Z",
                  extras: {
                    builderTaskId: "t",
                    projectId: "p",
                    branchName: "b",
                  },
                },
              ],
            },
          ],
        },
        {
          kind: "provider",
          operation: "builder.check",
          answers: [crashAfter(() => effects.push("checked"))],
        },
        { kind: "tick" },
        {
          kind: "provider",
          operation: "builder.check",
          answers: [ok({ state: "working", hasPullRequest: false })],
        },
        {
          kind: "inbox",
          source: "status",
          thenAlways: { ok: true, items: [] },
        },
        { kind: "tick", at: "2026-10-19T12:05:00.000Z" },
      ],
    });

    expect(run.ticks[0]).toMatchObject({
      outcome: "crashed",
      crash: expect.stringContaining("died"),
    });
    expect(run.ticks[0].steps.map((step) => step.nodeId)).toContain("byTask");
    expect(effects).toEqual(["checked"]);
    expect(run.ticks[1].outcome).toBe("ran");
  });

  it("lets any other error through, so a broken script fails loudly instead of reading as a crash", async () => {
    await expect(
      runStoryScript("builder-to-merge", { steps: [{ kind: "tick" }] }),
    ).rejects.toThrow(/no answer left/);
    expect(new SimulatedCrash()).toBeInstanceOf(Error);
  });
});
