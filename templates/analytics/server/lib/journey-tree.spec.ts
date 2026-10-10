import { describe, expect, it } from "vitest";

import type { JourneyStep } from "./journey-steps";
import {
  buildJourneyTree,
  MAX_JOURNEY_KEY_CHARS,
  MAX_JOURNEY_LABEL_CHARS,
  MAX_OTHER_BRANCH_SUMMARIES_PER_TREE,
  MAX_OTHER_BRANCH_SUMMARY_BYTES_PER_TREE,
  type BuildJourneyTreeOptions,
  type JourneyNode,
  type JourneyRecording,
  type JourneySession,
} from "./journey-tree";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const MIN = 60_000;

function steps(...keys: string[]): JourneyStep[] {
  return keys.map((key, index) => ({
    key,
    label: key.toUpperCase(),
    tsMs: T0 + index * 10_000,
  }));
}

function session(
  sessionId: string,
  keys: string[],
  startMs = T0,
): JourneySession {
  return {
    sessionId,
    steps: steps(...keys).map((step, index) => ({
      ...step,
      tsMs: startMs + index * 10_000,
    })),
  };
}

const OPTIONS: BuildJourneyTreeOptions = {
  maxDepth: 8,
  minNodeSessions: 1,
  examplesPerNode: 3,
  settleMs: 300,
  recency: "newest",
};

function recording(
  id: string,
  sessionId: string,
  overrides: Partial<JourneyRecording> = {},
): JourneyRecording {
  return {
    id,
    sessionId,
    startedAtMs: T0 - 5_000,
    endedAtMs: T0 + 10 * MIN,
    durationMs: null,
    viewport: { status: "known", width: 1440, height: 900 },
    ...overrides,
  };
}

const byKey = (nodes: JourneyNode[]) =>
  new Map(nodes.map((node) => [node.key, node]));

const SESSIONS: JourneySession[] = [
  session("a", ["signup", "role", "choice", "builder"]),
  session("b", ["signup", "role", "choice", "builder", "home"]),
  session("c", ["signup", "role", "choice", "custom"]),
  session("d", ["signup", "role"]),
  session("e", ["signup"]),
];

describe("buildJourneyTree", () => {
  it("counts sessions, splits, and drop-off per node", () => {
    const { rootN, nodes } = buildJourneyTree(SESSIONS, new Map(), OPTIONS);
    const node = byKey(nodes);
    expect(rootN).toBe(5);
    expect(nodes[0]).toMatchObject({
      key: "signup",
      parentKey: null,
      depth: 1,
    });

    expect(node.get("signup")).toMatchObject({
      n: 5,
      pctOfRoot: 100,
      pctOfParent: 100,
      dropoffN: 1,
      dropoffPct: 20,
      kind: "step",
    });
    expect(node.get("signup > role")).toMatchObject({
      n: 4,
      pctOfRoot: 80,
      pctOfParent: 80,
      dropoffN: 1,
      dropoffPct: 25,
    });
    expect(node.get("signup > role > choice > builder")).toMatchObject({
      n: 2,
      pctOfRoot: 40,
      pctOfParent: 66.67,
      dropoffN: 1,
      dropoffPct: 50,
      parentKey: "signup > role > choice",
      depth: 4,
    });
    expect(node.get("signup > role > choice > custom")).toMatchObject({
      n: 1,
      pctOfParent: 33.33,
      dropoffN: 1,
    });
  });

  it("lists parents before children with the biggest branch first", () => {
    const { nodes } = buildJourneyTree(SESSIONS, new Map(), OPTIONS);
    const keys = nodes.map((node) => node.key);
    for (const node of nodes) {
      if (node.parentKey) {
        expect(keys.indexOf(node.parentKey)).toBeLessThan(
          keys.indexOf(node.key),
        );
      }
    }
    expect(keys.indexOf("signup > role > choice > builder")).toBeLessThan(
      keys.indexOf("signup > role > choice > custom"),
    );
  });

  it("accounts for drop-off, represented children, and unrepresented continuation", () => {
    const { nodes } = buildJourneyTree(SESSIONS, new Map(), OPTIONS);
    for (const node of nodes) {
      const childN = nodes
        .filter((candidate) => candidate.parentKey === node.key)
        .reduce((sum, candidate) => sum + candidate.n, 0);
      expect(node.n, node.key).toBe(node.dropoffN + childN + node.deeperN);
    }
  });

  it("merges branches under minNodeSessions into one other node per parent", () => {
    const sessions = [
      ...SESSIONS,
      session("f", ["signup", "role", "choice", "other_one"]),
    ];
    const { nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      minNodeSessions: 2,
    });
    const node = byKey(nodes);
    expect(node.has("signup > role > choice > custom")).toBe(false);
    expect(node.has("signup > role > choice > other_one")).toBe(false);
    expect(node.get("signup > role > choice > other")).toMatchObject({
      kind: "other",
      label: "Other (2 branches)",
      parentKey: "signup > role > choice",
      depth: 4,
      n: 2,
      pctOfParent: 50,
      dropoffN: 2,
      dropoffPct: 100,
      examples: [],
      otherBranchCount: 2,
      otherBranches: [
        {
          path: ["SIGNUP", "ROLE", "CHOICE", "CUSTOM"],
          key: "signup > role > choice > custom",
          n: 1,
          pctOfParent: 25,
        },
        {
          path: ["SIGNUP", "ROLE", "CHOICE", "OTHER_ONE"],
          key: "signup > role > choice > other_one",
          n: 1,
          pctOfParent: 25,
        },
      ],
    });
    const choice = nodes.find(
      (candidate) => candidate.key === "signup > role > choice",
    )!;
    const childN = nodes
      .filter((candidate) => candidate.parentKey === choice.key)
      .reduce((sum, candidate) => sum + candidate.n, 0);
    expect(choice.n).toBe(choice.dropoffN + childN + choice.deeperN);
  });

  it("caps the branch disclosure while preserving its total count", () => {
    const sessions = Array.from({ length: 22 }, (_, index) =>
      session(`s${index}`, [`branch-${String(index).padStart(2, "0")}`]),
    );
    const { rootN, nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      minNodeSessions: 2,
    });
    const other = nodes[0]!;

    expect(rootN).toBe(22);
    expect(other).toMatchObject({
      kind: "other",
      n: 22,
      otherBranchCount: 22,
    });
    expect(other.otherBranches).toHaveLength(20);
    expect(other.otherBranches?.[0]).toMatchObject({
      path: ["BRANCH-00"],
      key: "branch-00",
      n: 1,
      pctOfParent: 4.55,
    });
    expect(
      other.otherBranches?.some((branch) => branch.key === "branch-21"),
    ).toBe(false);
  });

  it("caps branch summaries across the tree without reducing aggregate metrics", () => {
    const sessions = Array.from({ length: 12 }, (_, parentIndex) =>
      Array.from({ length: 25 }, (_, branchIndex) =>
        session(`s${parentIndex}-${branchIndex}`, [
          `parent-${String(parentIndex).padStart(2, "0")}`,
          `branch-${String(branchIndex).padStart(2, "0")}`,
        ]),
      ),
    ).flat();
    const { rootN, nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      maxDepth: 2,
      minNodeSessions: 2,
      examplesPerNode: 0,
    });
    const otherNodes = nodes.filter((candidate) => candidate.kind === "other");
    const summaryCount = otherNodes.reduce(
      (sum, candidate) => sum + (candidate.otherBranches?.length ?? 0),
      0,
    );

    expect(rootN).toBe(300);
    expect(otherNodes).toHaveLength(12);
    expect(summaryCount).toBe(MAX_OTHER_BRANCH_SUMMARIES_PER_TREE);
    expect(otherNodes[0]).toMatchObject({
      n: 25,
      pctOfRoot: 8.33,
      pctOfParent: 100,
      otherBranchCount: 25,
      otherBranchSummariesPartial: true,
    });
    expect(
      otherNodes
        .slice(0, 10)
        .every((candidate) => candidate.otherBranches?.length === 20),
    ).toBe(true);
    expect(
      otherNodes
        .slice(10)
        .every(
          (candidate) =>
            candidate.otherBranches === undefined &&
            candidate.otherBranchSummariesPartial === true,
        ),
    ).toBe(true);
  });

  it("prioritizes shallow Other details before descendant summaries use the tree budget", () => {
    const sessions = [
      ...Array.from({ length: 12 }, (_, parentIndex) =>
        Array.from({ length: 21 }, (_, branchIndex) =>
          session(`s${parentIndex}-${branchIndex}`, [
            `major-${String(parentIndex).padStart(2, "0")}`,
            `branch-${String(branchIndex).padStart(2, "0")}`,
          ]),
        ),
      ).flat(),
      ...Array.from({ length: 30 }, (_, index) =>
        session(`root-rare-${String(index).padStart(2, "0")}`, [
          `root-rare-${String(index).padStart(2, "0")}`,
        ]),
      ),
    ];
    const { rootN, nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      maxDepth: 2,
      minNodeSessions: 20,
      examplesPerNode: 0,
    });
    const rootOther = nodes.find(
      (candidate) => candidate.key === "root > other",
    );
    const summaryCount = nodes.reduce(
      (sum, candidate) => sum + (candidate.otherBranches?.length ?? 0),
      0,
    );

    expect(rootN).toBe(282);
    expect(rootOther).toMatchObject({
      n: 30,
      pctOfRoot: 10.64,
      pctOfParent: 10.64,
      otherBranchCount: 30,
      otherBranchSummariesPartial: true,
    });
    expect(rootOther?.otherBranches).toHaveLength(20);
    expect(rootOther?.otherBranches?.[0]?.path).toEqual(["ROOT-RARE-00"]);
    expect(rootOther?.otherBranches?.[19]?.path).toEqual(["ROOT-RARE-19"]);
    expect(summaryCount).toBe(MAX_OTHER_BRANCH_SUMMARIES_PER_TREE);
  });

  it("caps serialized branch summary bytes across the tree", () => {
    const sessions = Array.from({ length: 20 }, (_, index) =>
      session(`s${index}`, [
        "major",
        `branch-${"k".repeat(1_800)}-${String(index).padStart(2, "0")}`,
      ]).steps.map((step, stepIndex) =>
        stepIndex === 1
          ? { ...step, label: `Branch ${"L".repeat(280)} ${index}` }
          : step,
      ),
    ).map((journeySteps, index) => ({
      sessionId: `s${index}`,
      steps: journeySteps,
    }));
    const { nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      maxDepth: 2,
      minNodeSessions: 2,
      examplesPerNode: 0,
    });
    const other = nodes.find((candidate) => candidate.kind === "other")!;
    const summaryBytes = new TextEncoder().encode(
      JSON.stringify(other.otherBranches ?? []),
    ).byteLength;

    expect(other).toMatchObject({
      n: 20,
      pctOfParent: 100,
      otherBranchCount: 20,
      otherBranchSummariesPartial: true,
    });
    expect(other.otherBranches?.length).toBeLessThan(20);
    expect(summaryBytes).toBeLessThanOrEqual(
      MAX_OTHER_BRANCH_SUMMARY_BYTES_PER_TREE,
    );
  });

  it("bounds serialized labels and keys without changing branch metrics", () => {
    const longLabel = `Unusually long step ${"workspace/".repeat(40)}`;
    const longKey = `step:${"source-key/".repeat(220)}`;
    const sessions: JourneySession[] = ["a", "b"].map((sessionId, index) => ({
      sessionId,
      steps: [
        { key: "signup", label: "Sign up", tsMs: T0 },
        {
          key: `${longKey}${index}`,
          label: longLabel,
          tsMs: T0 + 10_000,
        },
      ],
    }));
    const { rootN, nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      minNodeSessions: 2,
    });
    const other = nodes.find((node) => node.kind === "other")!;

    expect(rootN).toBe(2);
    expect(other).toMatchObject({
      n: 2,
      pctOfRoot: 100,
      pctOfParent: 100,
      otherBranchCount: 2,
    });
    expect(other.otherBranches).toHaveLength(2);
    for (const branch of other.otherBranches ?? []) {
      expect(branch.path).toHaveLength(2);
      expect(branch.path[1]).toHaveLength(MAX_JOURNEY_LABEL_CHARS);
      expect(branch.path[1]).toMatch(/…#[a-f0-9]{16}$/);
      expect(branch.pathTruncated).toBe(true);
      expect(branch.key).toHaveLength(MAX_JOURNEY_KEY_CHARS);
      expect(branch.key).toMatch(/…#[a-f0-9]{16}$/);
      expect(branch.keyTruncated).toBe(true);
      expect(branch.sourceStepKey).toHaveLength(MAX_JOURNEY_KEY_CHARS);
      expect(branch.sourceStepKey).toMatch(/…#[a-f0-9]{16}$/);
      expect(branch.sourceStepKeyTruncated).toBe(true);
      expect(branch.n).toBe(1);
      expect(branch.pctOfParent).toBe(50);
    }
    expect(
      nodes.every(
        (node) =>
          node.key.length <= MAX_JOURNEY_KEY_CHARS &&
          node.label.length <= MAX_JOURNEY_LABEL_CHARS &&
          (node.parentKey?.length ?? 0) <= MAX_JOURNEY_KEY_CHARS,
      ),
    ).toBe(true);
  });

  it("bounds deep path IDs with stable hashes", () => {
    const longPath = session(
      "deep",
      Array.from(
        { length: 30 },
        (_, index) => `step-${"x".repeat(100)}-${index}`,
      ),
    );
    const options = { ...OPTIONS, maxDepth: 40 };
    const first = buildJourneyTree([longPath], new Map(), options).nodes;
    const second = buildJourneyTree([longPath], new Map(), options).nodes;

    expect(
      first.every((node) => node.key.length <= MAX_JOURNEY_KEY_CHARS),
    ).toBe(true);
    expect(
      first.some(
        (node) =>
          node.keyTruncated &&
          /…#[a-f0-9]{16}$/.test(node.key) &&
          node.parentKey &&
          node.parentKey.length <= MAX_JOURNEY_KEY_CHARS,
      ),
    ).toBe(true);
    expect(first.map((node) => node.key)).toEqual(
      second.map((node) => node.key),
    );
  });

  it("counts sessions cut at maxDepth in n but not as drop-off", () => {
    const { nodes } = buildJourneyTree(SESSIONS, new Map(), {
      ...OPTIONS,
      maxDepth: 2,
    });
    const node = byKey(nodes);
    expect(nodes.every((candidate) => candidate.depth <= 2)).toBe(true);
    // a, b, c continue past depth 2; d ends there.
    expect(node.get("signup > role")).toMatchObject({
      n: 4,
      dropoffN: 1,
      deeperN: 3,
    });
  });

  it("keeps a step key that contains the path delimiter apart from a two-step path", () => {
    const { nodes } = buildJourneyTree(
      [
        session("a", ["step:x > method:y"]),
        session("b", ["step:x", "method:y"]),
        session("c", ["100%", "a>b"]),
      ],
      new Map(),
      OPTIONS,
    );
    const keys = nodes.map((node) => node.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("step:x %3E method:y");
    expect(keys).toContain("step:x > method:y");
    expect(keys).toContain("100%25 > a%3Eb");
    expect(
      nodes.every(
        (node) => node.parentKey === null || keys.includes(node.parentKey),
      ),
    ).toBe(true);
  });

  it("returns an empty tree for no sessions, not a root with a count", () => {
    expect(buildJourneyTree([], new Map(), OPTIONS)).toEqual({
      rootN: 0,
      nodes: [],
    });
  });
});

describe("example selection", () => {
  const sessions = ["s1", "s2", "s3", "s4"].map((id, index) =>
    session(id, ["signup", "role"], T0 + index * MIN),
  );

  it("prefers sessions with a covering recording, then the most recent", () => {
    const recordings = new Map<string, JourneyRecording[]>([
      ["s1", [recording("r1", "s1")]],
      [
        "s3",
        [
          recording("r3", "s3", {
            startedAtMs: T0 + 2 * MIN - 5_000,
            endedAtMs: T0 + 9 * MIN,
          }),
        ],
      ],
    ]);
    const { nodes } = buildJourneyTree(sessions, recordings, {
      ...OPTIONS,
      examplesPerNode: 3,
    });
    const examples = byKey(nodes).get("signup")!.examples;
    expect(examples.map((example) => example.sessionId)).toEqual([
      "s3",
      "s1",
      "s4",
    ]);
    expect(examples[0]).toMatchObject({
      recordingId: "r3",
      viewport: { width: 1440, height: 900 },
    });
    expect(examples[0]).not.toHaveProperty("viewportReason");
    expect(examples[2]).toMatchObject({
      recordingId: null,
      offsetMs: null,
      viewport: null,
      viewportReason: "no_recording",
    });
  });

  it("is deterministic regardless of input order", () => {
    const recordings = new Map<string, JourneyRecording[]>([
      ["s2", [recording("r2", "s2")]],
      ["s4", [recording("r4", "s4")]],
    ]);
    const forward = buildJourneyTree(sessions, recordings, OPTIONS);
    const backward = buildJourneyTree(
      [...sessions].reverse(),
      recordings,
      OPTIONS,
    );
    expect(backward).toEqual(forward);
  });

  it("orders by session id when recency is off", () => {
    const { nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      recency: "none",
    });
    expect(
      byKey(nodes)
        .get("signup")!
        .examples.map((e) => e.sessionId),
    ).toEqual(["s1", "s2", "s3"]);
  });

  it("seeks to the step plus settle time, inside the recording", () => {
    const s = session("x", ["signup", "role"], T0 + 20_000);
    const recordings = new Map([
      [
        "x",
        [recording("rx", "x", { startedAtMs: T0, endedAtMs: T0 + 20_200 })],
      ],
    ]);
    const { nodes } = buildJourneyTree([s], recordings, OPTIONS);
    const node = byKey(nodes);
    // signup at +20_000 plus 300ms settle, clamped to the 20_200ms recording.
    expect(node.get("signup")!.examples[0]!.offsetMs).toBe(20_200);
    // role fires after the recording ended, so no frame can show it.
    expect(node.get("signup > role")!.examples[0]).toMatchObject({
      recordingId: null,
      offsetMs: null,
    });
    const wide = buildJourneyTree(
      [s],
      new Map([
        ["x", [recording("rx", "x", { startedAtMs: T0, endedAtMs: T0 + MIN })]],
      ]),
      OPTIONS,
    );
    expect(byKey(wide.nodes).get("signup")!.examples[0]!.offsetMs).toBe(20_300);
  });

  it("does not offer a recording that ended before the step", () => {
    const s = session("x", ["signup"], T0 + 30 * MIN);
    const recordings = new Map([["x", [recording("rx", "x")]]]);
    const example = buildJourneyTree([s], recordings, OPTIONS).nodes[0]!
      .examples[0]!;
    expect(example.recordingId).toBeNull();
  });

  it("does not claim a later step lies in a recording with no known end", () => {
    const open = { endedAtMs: null, durationMs: null };
    const late = buildJourneyTree(
      [session("x", ["signup"], T0 + 30 * MIN)],
      new Map([["x", [recording("rx", "x", open)]]]),
      OPTIONS,
    ).nodes[0]!.examples[0]!;
    expect(late).toMatchObject({ recordingId: null, offsetMs: null });
    const atStart = buildJourneyTree(
      [session("x", ["signup"], T0)],
      new Map([["x", [recording("rx", "x", { ...open, startedAtMs: T0 })]]]),
      OPTIONS,
    ).nodes[0]!.examples[0]!;
    expect(atStart.recordingId).toBe("rx");
  });

  it("adds replayUrl only when the caller can build one", () => {
    const recordings = new Map([["s1", [recording("r 1", "s1")]]]);
    const withUrl = buildJourneyTree(sessions, recordings, {
      ...OPTIONS,
      replayUrlFor: (id, offsetMs) =>
        `https://x.test/sessions/${id}?atMs=${offsetMs}`,
    });
    const example = byKey(withUrl.nodes).get("signup")!.examples[0]!;
    expect(example.replayUrl).toBe("https://x.test/sessions/r 1?atMs=5300");
    const without = buildJourneyTree(sessions, recordings, OPTIONS);
    expect(byKey(without.nodes).get("signup")!.examples[0]).not.toHaveProperty(
      "replayUrl",
    );
  });

  it("skips examples entirely when examplesPerNode is 0", () => {
    const { nodes } = buildJourneyTree(sessions, new Map(), {
      ...OPTIONS,
      examplesPerNode: 0,
    });
    expect(nodes.every((node) => node.examples.length === 0)).toBe(true);
  });
});

describe("viewport constraints", () => {
  const sessions = ["wide", "narrow", "unknown", "unreadable"].map((id, i) =>
    session(id, ["signup"], T0 + i * MIN),
  );
  const recordings = new Map<string, JourneyRecording[]>([
    [
      "wide",
      [
        recording("rw", "wide", {
          viewport: { status: "known", width: 1920, height: 1080 },
        }),
      ],
    ],
    [
      "narrow",
      [
        recording("rn", "narrow", {
          viewport: { status: "known", width: 390, height: 844 },
        }),
      ],
    ],
    [
      "unknown",
      [recording("ru", "unknown", { viewport: { status: "not_captured" } })],
    ],
    [
      "unreadable",
      [recording("rx", "unreadable", { viewport: { status: "unreadable" } })],
    ],
  ]);
  const ids = (options: Partial<BuildJourneyTreeOptions>) =>
    buildJourneyTree(sessions, recordings, {
      ...OPTIONS,
      examplesPerNode: 10,
      ...options,
    }).nodes[0]!.examples.map((example) => [
      example.sessionId,
      example.viewportReason ?? "known",
    ]);

  it("filters by aspect and keeps unknown viewports, flagged", () => {
    expect(ids({ viewport: { minAspect: 1.2 } })).toEqual([
      ["wide", "known"],
      ["unreadable", "unreadable"],
      ["unknown", "not_captured"],
    ]);
    expect(ids({ viewport: { maxAspect: 0.7 } })).toEqual([
      ["narrow", "known"],
      ["unreadable", "unreadable"],
      ["unknown", "not_captured"],
    ]);
  });

  it("filters by width", () => {
    expect(ids({ viewport: { maxWidth: 500, requireKnown: true } })).toEqual([
      ["narrow", "known"],
    ]);
    expect(ids({ viewport: { minWidth: 1000, requireKnown: true } })).toEqual([
      ["wide", "known"],
    ]);
  });

  it("requireKnown drops unknown and recording-less sessions", () => {
    const withMissing = [
      ...sessions,
      session("none", ["signup"], T0 + 9 * MIN),
    ];
    const { nodes } = buildJourneyTree(withMissing, recordings, {
      ...OPTIONS,
      examplesPerNode: 10,
      viewport: { requireKnown: true },
    });
    expect(nodes[0]!.examples.map((e) => e.sessionId).sort()).toEqual([
      "narrow",
      "wide",
    ]);
    expect(nodes[0]!.n).toBe(5);
  });
});
