import { describe, expect, it } from "vitest";

import { callsTo, effectsOf, scenarioRun, tickAt } from "../proof-kit.js";

const STORY = "morning-digest";
const FRIDAY_8AM = "2026-10-16T12:00:00.000Z";
const MONDAY_8AM = "2026-10-19T12:00:00.000Z";
const TUESDAY_8AM = "2026-10-20T12:00:00.000Z";
const window = (from: string, to: string) => ({ from, to });

describe("story 3 proofs: the morning digest", () => {
  it("reads Friday 08:00 to Monday 08:00 on Monday, and sends one digest for the morning", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "monday-reads-friday-to-monday-and-posts-once",
    );

    expect(tickAt(summary, 0).windows["github.listCommits"]).toEqual(
      window(FRIDAY_8AM, MONDAY_8AM),
    );
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(effectsOf(summary)[0].receipt).toMatchObject({ status: "done" });
    // The same tick delivered again finds its work done: no read, no model call, no second post.
    expect(tickAt(summary, 1)).toMatchObject({
      outcome: "nothing_due",
      calls: {},
      ai: [],
      effects: [],
    });
  });

  it("starts each morning's window where the last one ended", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "tuesday-starts-where-monday-ended",
    );

    expect(tickAt(summary, 0).windows["github.listCommits"]).toEqual(
      window(FRIDAY_8AM, MONDAY_8AM),
    );
    expect(tickAt(summary, 1).windows["github.listCommits"]).toEqual(
      window(MONDAY_8AM, TUESDAY_8AM),
    );
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(2);
  });

  it("posts on a quiet morning too, with a count of zero for the text to say so", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "a-quiet-morning-still-posts-a-count-of-zero",
    );

    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(run.ticks[0].aiRequests[0].items[0].item).toMatchObject({
      count: 0,
      items: [],
    });
  });

  it("does not hide a cut-off: the step records it and the writer is told the list is partial", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "a-cut-off-list-says-how-much-was-cut",
    );

    expect(tickAt(summary, 0).nodes.commits).toMatchObject({
      ports: { out: 100 },
      truncatedFrom: 340,
    });
    expect(run.ticks[0].aiRequests[0].items[0].item).toMatchObject({
      count: 100,
      truncated: true,
      totalAvailable: 340,
    });
  });

  it("does not move the window on a failed morning, so the next digest covers the gap", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "github-down-then-back-covers-the-missed-morning",
    );

    expect(tickAt(summary, 1).run).toMatchObject({
      status: "failed",
      error: "provider_error",
    });
    expect(tickAt(summary, 1).effects).toEqual([]);
    // Tuesday reaches back past the failed Monday to the last good run on Friday.
    expect(tickAt(summary, 2).windows["github.listCommits"]).toEqual(
      window(FRIDAY_8AM, TUESDAY_8AM),
    );
    expect(callsTo(summary, "slack.postMessage")).toBe(2);
  });

  it("sends nothing from a dry run", async () => {
    const { summary } = await scenarioRun(STORY, "a-dry-run-posts-nothing");

    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    expect(tickAt(summary, 0)).toMatchObject({ mode: "dry", effects: [] });
  });
});
