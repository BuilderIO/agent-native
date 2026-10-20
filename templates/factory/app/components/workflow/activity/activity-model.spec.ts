import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createItemsStrings } from "../items-strings";
import type {
  ActivityEntry,
  RunActivity,
  RunStatus,
} from "../items/read-types";
import {
  DEFAULT_ACTIVITY_FILTERS,
  activityQueryParams,
  actorLabel as actorLabelOf,
  dayBreaks,
  describeRunCounts as describeRunCountsOf,
  hasActivityFilters,
  linkAction as linkActionOf,
  rangeSince,
  runStatusView as runStatusViewOf,
} from "./activity-model";

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();
const s = createItemsStrings(createEnglishTranslator());
const actorLabel = (actor: ActivityEntry["actor"]) => actorLabelOf(actor, s);
const describeRunCounts = (counts: RunActivity["counts"]) =>
  describeRunCountsOf(counts, s);
const linkAction = (entry: ActivityEntry) => linkActionOf(entry, s);
const runStatusView = (status: RunStatus) => runStatusViewOf(status, s);

function entry(over: Record<string, unknown>): ActivityEntry {
  return {
    id: "a",
    at: new Date(2026, 9, 18, 10, 0).toISOString(),
    workflowId: "wf1",
    workflowName: "Bug report to Builder",
    actor: { kind: "schedule", email: null },
    link: { type: "run", workflowId: "wf1", runId: "r1" },
    kind: "run",
    status: "succeeded",
    mode: "live",
    triggerKind: "schedule",
    counts: {},
    error: null,
    ...over,
  } as ActivityEntry;
}

describe("rangeSince", () => {
  it("is the start of the window, and null for all time", () => {
    expect(rangeSince("day", NOW)).toBe(
      new Date(NOW - 24 * 3600_000).toISOString(),
    );
    expect(rangeSince("week", NOW)).toBe(
      new Date(NOW - 7 * 24 * 3600_000).toISOString(),
    );
    expect(rangeSince("all", NOW)).toBeNull();
  });
});

describe("activityQueryParams", () => {
  it("sends only the filters that are set", () => {
    expect(activityQueryParams("f1", DEFAULT_ACTIVITY_FILTERS, null)).toEqual({
      factoryId: "f1",
      limit: 25,
    });
    expect(
      activityQueryParams(
        "f1",
        { workflowId: "wf1", who: "agent", kind: "change", range: "day" },
        "2026-10-17T12:00:00.000Z",
      ),
    ).toEqual({
      factoryId: "f1",
      limit: 25,
      workflowId: "wf1",
      who: "agent",
      kind: "change",
      since: "2026-10-17T12:00:00.000Z",
    });
  });

  it("counts a changed range as a filter, so an empty feed can offer to clear it", () => {
    expect(hasActivityFilters(DEFAULT_ACTIVITY_FILTERS)).toBe(false);
    expect(
      hasActivityFilters({ ...DEFAULT_ACTIVITY_FILTERS, range: "all" }),
    ).toBe(true);
    expect(
      hasActivityFilters({ ...DEFAULT_ACTIVITY_FILTERS, kind: "run" }),
    ).toBe(true);
  });
});

describe("dayBreaks", () => {
  const today1 = entry({
    id: "t1",
    at: new Date(2026, 9, 18, 10, 0).toISOString(),
  });
  const today2 = entry({
    id: "t2",
    at: new Date(2026, 9, 18, 9, 0).toISOString(),
  });
  const yesterday = entry({
    id: "y1",
    at: new Date(2026, 9, 17, 17, 0).toISOString(),
  });

  it("starts a heading at the first entry and wherever the day changes", () => {
    const { breaks, lastDay } = dayBreaks(
      [today1, today2, yesterday],
      undefined,
    );
    expect([...breaks.keys()]).toEqual(["t1", "y1"]);
    expect(lastDay).toBe("2026-10-17");
  });

  it("draws no second heading when the next page continues the same day", () => {
    const first = dayBreaks([today1], undefined);
    const second = dayBreaks([today2, yesterday], first.lastDay);
    expect([...second.breaks.keys()]).toEqual(["y1"]);
  });

  it("carries the day through an empty page", () => {
    expect(dayBreaks([], "2026-10-18").lastDay).toBe("2026-10-18");
  });
});

describe("describeRunCounts", () => {
  it("lists only what happened, in a fixed order", () => {
    expect(
      describeRunCounts({
        taken: 3,
        done: 1,
        dismissed: 1,
        needsManual: 1,
        modelCalls: 6,
      }),
    ).toBe("Took 3 items: 1 done, 1 dismissed, 1 handed to a person");
    expect(describeRunCounts({ taken: 1 })).toBe("Took 1 item");
  });

  it("says nothing new for a run that took nothing", () => {
    expect(describeRunCounts({})).toBe("Nothing new");
    expect(describeRunCounts({ taken: 0, modelCalls: 0 })).toBe("Nothing new");
  });

  it("still reports a failure on a run that took nothing", () => {
    expect(describeRunCounts({ taken: 0, itemFailures: 2 })).toBe(
      "Took 0 items: 2 items failed",
    );
  });
});

describe("runStatusView", () => {
  it("marks failed as attention and paused as waiting", () => {
    expect(runStatusView("failed")).toEqual({
      label: "Failed",
      tone: "attention",
    });
    expect(runStatusView("paused")).toEqual({
      label: "Paused",
      tone: "waiting",
    });
    expect(runStatusView("succeeded")).toEqual({
      label: "OK",
      tone: "neutral",
    });
  });
});

describe("actorLabel", () => {
  it("names a person by the part of the email before the at sign", () => {
    expect(actorLabel({ kind: "person", email: "enzo@builder.io" })).toBe(
      "enzo",
    );
    expect(actorLabel({ kind: "person", email: null })).toBe("Person");
  });

  it("names the agent, the schedule, and a service by their kind", () => {
    expect(actorLabel({ kind: "agent", email: null })).toBe("Agent");
    expect(actorLabel({ kind: "service", email: null })).toBe("Service");
    expect(actorLabel({ kind: "schedule", email: null })).toBe("Schedule");
  });
});

describe("linkAction", () => {
  it("opens a run, a version, or an item journey from the entry's link", () => {
    expect(linkAction(entry({}))).toMatchObject({
      kind: "run",
      runId: "r1",
      label: "Open run",
    });
    expect(
      linkAction(
        entry({
          kind: "change",
          change: "saved",
          link: { type: "version", workflowId: "wf1", version: 14 },
        }),
      ),
    ).toMatchObject({ kind: "version", version: 14, label: "View version 14" });
    expect(
      linkAction(
        entry({
          kind: "needs_you",
          link: { type: "item", workflowId: "wf1", itemId: "i1" },
        }),
      ),
    ).toMatchObject({ kind: "item", itemId: "i1" });
  });

  it("says Open workflow for a version link that names no version", () => {
    expect(
      linkAction(
        entry({
          kind: "change",
          change: "enabled",
          link: { type: "version", workflowId: "wf1", version: null },
        }),
      ),
    ).toMatchObject({ label: "Open workflow" });
  });

  it("gives a deleted workflow no link, since there is nothing to open", () => {
    expect(
      linkAction(
        entry({
          kind: "change",
          change: "deleted",
          link: { type: "version", workflowId: "wf1", version: null },
        }),
      ),
    ).toBeNull();
  });
});
