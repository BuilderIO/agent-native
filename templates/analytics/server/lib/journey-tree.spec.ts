import { describe, expect, it } from "vitest";

import type { JourneyStep } from "./journey-steps";
import {
  buildJourneyTree,
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

  it("keeps n = dropoffN + continuing sessions for every node", () => {
    const { nodes } = buildJourneyTree(SESSIONS, new Map(), OPTIONS);
    for (const node of nodes) {
      const childN = nodes
        .filter((candidate) => candidate.parentKey === node.key)
        .reduce((sum, candidate) => sum + candidate.n, 0);
      expect(node.n, node.key).toBe(node.dropoffN + childN);
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
    });
    const choice = nodes.find(
      (candidate) => candidate.key === "signup > role > choice",
    )!;
    const childN = nodes
      .filter((candidate) => candidate.parentKey === choice.key)
      .reduce((sum, candidate) => sum + candidate.n, 0);
    expect(choice.n).toBe(choice.dropoffN + childN);
  });

  it("counts sessions cut at maxDepth in n but not as drop-off", () => {
    const { nodes } = buildJourneyTree(SESSIONS, new Map(), {
      ...OPTIONS,
      maxDepth: 2,
    });
    const node = byKey(nodes);
    expect(nodes.every((candidate) => candidate.depth <= 2)).toBe(true);
    // a, b, c continue past depth 2; d ends there.
    expect(node.get("signup > role")).toMatchObject({ n: 4, dropoffN: 1 });
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
