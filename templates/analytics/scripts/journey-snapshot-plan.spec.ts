import { describe, expect, it } from "vitest";

import {
  allocateFrameBudgets,
  compareTrees,
  defaultSnapshotWeek,
  isReusableCaptureSelection,
  selectCaptureTree,
  SNAPSHOT_MAX_FRAMES,
  SNAPSHOT_PRESET,
  snapshotCanvasCacheKey,
  snapshotTreeCacheKey,
  snapshotPresetHash,
  treeTopForks,
  weekWindow,
  type SnapshotExample,
  type SnapshotNode,
  type SnapshotTree,
} from "./journey-snapshot-plan.js";

function example(overrides: Partial<SnapshotExample> = {}): SnapshotExample {
  return {
    sessionId: "session-1",
    recordingId: "recording-1",
    ts: "2026-10-20T12:00:00.000Z",
    offsetMs: 1000,
    viewport: { width: 1440, height: 900 },
    ...overrides,
  };
}

function node(
  key: string,
  label: string,
  parentKey: string | null,
  depth: number,
  n: number,
  overrides: Partial<SnapshotNode> = {},
): SnapshotNode {
  return {
    key,
    label,
    parentKey,
    depth,
    n,
    pctOfRoot: 100,
    pctOfParent: 100,
    dropoffN: 0,
    dropoffPct: 0,
    examples: [example()],
    ...overrides,
  };
}

function tree(nodes: SnapshotNode[], rootN = 10, app = "clips"): SnapshotTree {
  return {
    window: { from: "2026-10-19", to: "2026-10-25" },
    app,
    rootN,
    coverage: {
      sessionsWithEvents: rootN,
      sessionsWithReplay: rootN,
      truncated: false,
      paginationConsistency: "stable",
    },
    nodes,
  };
}

describe("weekly snapshot preset", () => {
  it("defaults to the last full UTC week", () => {
    expect(defaultSnapshotWeek(new Date("2026-10-26T09:00:00.000Z"))).toBe(
      "2026-10-19",
    );
    expect(defaultSnapshotWeek(new Date("2026-10-25T23:59:00.000Z"))).toBe(
      "2026-10-12",
    );
  });

  it("keeps the query window anchored to a real UTC Monday", () => {
    expect(
      weekWindow("2026-10-19", new Date("2026-10-26T00:00:00.000Z")),
    ).toEqual({
      week: "2026-10-19",
      dateFrom: "2026-10-18",
      dateTo: "2026-10-25",
    });
    expect(() =>
      weekWindow("2026-10-19", new Date("2026-10-25T23:59:00.000Z")),
    ).toThrow(/fully closed/);
    expect(() =>
      weekWindow("2026-10-26", new Date("2026-10-26T00:00:00.000Z")),
    ).toThrow(/fully closed/);
    expect(() =>
      weekWindow("2026-10-18", new Date("2026-10-26T00:00:00.000Z")),
    ).toThrow(/Monday/);
    expect(SNAPSHOT_PRESET).toMatchObject({
      emailFilter: "exclude_builder",
      excludeNonProductionHosts: true,
      minAspect: 1.25,
      maxAspect: 1.8,
    });
  });

  it("keeps tree caches isolated by Analytics app URL", () => {
    const base = {
      app: "design",
      dateFrom: "2026-10-18",
      dateTo: "2026-10-25",
      splitDesignFirstTouch: true,
    };
    expect(
      snapshotPresetHash({
        ...base,
        sourceUrl: "https://analytics.example",
      }),
    ).not.toBe(
      snapshotPresetHash({
        ...base,
        sourceUrl: "https://analytics.example/team",
      }),
    );
  });

  it("keeps tree cache keys isolated by authenticated principal", () => {
    const identity = {
      presetHash: "preset",
      sourceUrl: "https://analytics.example/team",
    };
    expect(
      snapshotTreeCacheKey({
        ...identity,
        principalScopeHash: "principal-a",
      }),
    ).not.toBe(
      snapshotTreeCacheKey({
        ...identity,
        principalScopeHash: "principal-b",
      }),
    );
  });

  it("scopes Design canvas reuse to the Analytics principal too", () => {
    const designScope = {
      designUrl: "https://design.example/team",
      designScopeHash: "design-principal",
    };
    expect(
      snapshotCanvasCacheKey({
        ...designScope,
        analyticsScopeHash: "analytics-principal-a",
      }),
    ).not.toBe(
      snapshotCanvasCacheKey({
        ...designScope,
        analyticsScopeHash: "analytics-principal-b",
      }),
    );
  });

  it("reuses only completed capture selections", () => {
    expect(
      isReusableCaptureSelection(
        { selectionHash: "same", complete: true },
        "same",
      ),
    ).toBe(true);
    expect(
      isReusableCaptureSelection(
        { selectionHash: "same", complete: false },
        "same",
      ),
    ).toBe(false);
  });
});

describe("snapshot tree planning", () => {
  it("selects replayable paths within the frame limit and skips ultrawide examples", () => {
    const source = tree([
      node("signup", "Signup", null, 1, 10),
      node("signup > choice", "Setup choice", "signup", 2, 8),
      node(
        "signup > choice > output:recording_ready",
        "Clip saved",
        "signup > choice",
        3,
        6,
        {
          examples: [
            example({
              sessionId: "wide",
              recordingId: "wide-recording",
              viewport: { width: 2560, height: 1080 },
            }),
            example({
              sessionId: "desktop",
              recordingId: "desktop-recording",
            }),
          ],
        },
      ),
    ]);

    const selected = selectCaptureTree(source, 3);

    expect(selected.frameCount).toBe(3);
    expect(selected.tree.nodes.map((entry) => entry.key)).toEqual([
      "signup",
      "signup > choice",
      "signup > choice > output:recording_ready",
    ]);
    expect(selected.tree.nodes[2]!.examples).toMatchObject([
      { sessionId: "desktop", recordingId: "desktop-recording" },
    ]);
  });

  it("allocates only the board-wide frame budget across replayable bands", () => {
    const replayable = tree([node("signup", "Signup", null, 1, 10)]);
    const empty = tree(
      [node("signup", "Signup", null, 1, 0, { examples: [] })],
      0,
    );

    const budgets = allocateFrameBudgets(
      [
        { key: "control", tree: replayable },
        { key: "credits", tree: replayable },
        { key: "empty", tree: empty },
      ],
      SNAPSHOT_MAX_FRAMES,
    );

    expect(budgets.get("control")! + budgets.get("credits")!).toBe(
      SNAPSHOT_MAX_FRAMES,
    );
    expect(budgets.has("empty")).toBe(false);
  });

  it("preserves parent-relative branch counts", () => {
    const source = tree([
      node("signup", "Signup", null, 1, 10),
      node("signup > choice", "Setup choice", "signup", 2, 10),
      node("signup > choice > builder", "Use Builder", "signup > choice", 3, 6),
      node("signup > choice > custom", "Custom keys", "signup > choice", 3, 4),
    ]);
    source.nodes[1]!.dropoffN = 1;
    source.nodes[1]!.dropoffPct = 10;

    expect(treeTopForks(source)).toEqual([
      {
        key: "signup > choice",
        step: "Setup choice",
        n: 10,
        branches: [
          { label: "Use Builder", n: 6, pctOfParent: 100 },
          { label: "Custom keys", n: 4, pctOfParent: 100 },
        ],
        dropoffN: 1,
        dropoffPct: 10,
      },
    ]);
  });

  it("keeps fork counts attached to node identity when labels repeat", () => {
    const source = tree([
      node("signup", "Signup", null, 1, 10),
      node("signup > first-choice", "Setup choice", "signup", 2, 8),
      node(
        "signup > first-choice > builder",
        "Use Builder",
        "signup > first-choice",
        3,
        6,
      ),
      node(
        "signup > first-choice > custom",
        "Custom keys",
        "signup > first-choice",
        3,
        2,
      ),
      node("signup > second-choice", "Setup choice", "signup", 2, 2),
      node(
        "signup > second-choice > skip",
        "Skip",
        "signup > second-choice",
        3,
        1,
      ),
      node(
        "signup > second-choice > connect",
        "Connect",
        "signup > second-choice",
        3,
        1,
      ),
    ]);

    expect(
      treeTopForks(source)
        .filter((fork) => fork.step === "Setup choice")
        .map(({ key, n }) => ({ key, n })),
    ).toEqual([
      { key: "signup > first-choice", n: 8 },
      { key: "signup > second-choice", n: 2 },
    ]);
  });

  it("diffs direct-parent conversions and omits Clips recording attempts", () => {
    const previous = tree(
      [
        node("signup", "Signup", null, 1, 100),
        node("signup > choice", "Setup choice", "signup", 2, 20, {
          pctOfRoot: 20,
          pctOfParent: 20,
        }),
        node(
          "signup > choice > output:recording_ready",
          "Clip saved",
          "signup > choice",
          3,
          15,
          {
            pctOfRoot: 15,
            pctOfParent: 75,
          },
        ),
        node(
          "signup > choice > attempt:recording_started:2",
          "Recording attempt started",
          "signup > choice",
          3,
          12,
          {
            pctOfRoot: 12,
            pctOfParent: 60,
          },
        ),
      ],
      100,
    );
    const current = tree(
      [
        node("signup", "Signup", null, 1, 200),
        node("signup > choice", "Setup choice", "signup", 2, 100, {
          pctOfRoot: 50,
          pctOfParent: 50,
        }),
        node(
          "signup > choice > output:recording_ready",
          "Clip saved",
          "signup > choice",
          3,
          60,
          {
            pctOfRoot: 30,
            pctOfParent: 60,
          },
        ),
        node(
          "signup > choice > attempt:recording_started:2",
          "Recording attempt started",
          "signup > choice",
          3,
          2,
          {
            pctOfRoot: 1,
            pctOfParent: 2,
          },
        ),
      ],
      200,
    );

    const changes = compareTrees(current, previous, 5, [
      "attempt:recording_started",
    ]);

    expect(changes).toEqual([
      {
        key: "signup > choice",
        label: "Setup choice",
        currentPct: 50,
        previousPct: 20,
        currentN: 100,
        currentParentN: 200,
        previousN: 20,
        previousParentN: 100,
        deltaPoints: 30,
      },
      {
        key: "signup > choice > output:recording_ready",
        label: "Clip saved",
        currentPct: 60,
        previousPct: 75,
        currentN: 60,
        currentParentN: 100,
        previousN: 15,
        previousParentN: 20,
        deltaPoints: -15,
      },
    ]);
  });
});
