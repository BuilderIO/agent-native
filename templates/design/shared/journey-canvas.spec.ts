import { describe, expect, it } from "vitest";
import { toJSONSchema, type z } from "zod";

import arSA from "../app/i18n/ar-SA.js";
import { emptyBoardHtml } from "./board-file.js";
import {
  JOURNEY_BOARD_ID_PREFIX,
  JOURNEY_FILE_ID_PREFIX,
  JOURNEY_FILENAME_PREFIX,
  REPLAY_SCREENSHOT_ROUTE,
  createJourneyCanvasInputSchema,
  formatPercent,
  imageUrlProblem,
  planJourneyCanvas,
  replaceJourneyBoardObjects,
  type CreateJourneyCanvasInput,
} from "./journey-canvas.js";
import { CARD_PROVENANCE_HEADER_HEIGHT } from "./journey-layout.js";

type RawInput = z.input<typeof createJourneyCanvasInputSchema>;
type RawJourneyNode = RawInput["tree"]["nodes"][number];
type RawCohortNode = Extract<RawJourneyNode, { n: number }>;
type RawReferenceNode = Extract<RawJourneyNode, { referenceOnly: true }>;

const example = (sessionId: string, width = 1440, height = 900) => ({
  sessionId,
  recordingId: `rec-${sessionId}`,
  ts: "2026-10-01T12:00:00.000Z",
  offsetMs: 4_000,
  viewport: { width, height },
});

function node(
  key: string,
  parentKey: string | null,
  n: number,
  extra: Partial<RawCohortNode> = {},
): RawCohortNode {
  return {
    key,
    label: key,
    parentKey,
    depth: parentKey ? 2 : 1,
    kind: "step",
    n,
    pctOfRoot: (n / 1000) * 100,
    pctOfParent: 50,
    dropoffN: 0,
    dropoffPct: 0,
    examples: [example(`${key}-1`), example(`${key}-2`)],
    ...extra,
  };
}

function referenceNode(
  key: string,
  parentKey: string,
  depth: number,
  examples: RawJourneyNode["examples"],
): RawReferenceNode {
  return {
    key,
    label: key.split(" > ").pop()!,
    parentKey,
    depth,
    kind: "step",
    referenceOnly: true,
    examples,
  };
}

const frame = (
  nodeKey: string,
  exampleIndex: number,
  extra: Partial<RawInput["frames"][number]> = {},
): RawInput["frames"][number] => ({
  nodeKey,
  exampleIndex,
  imageUrl: `https://img.example.test/${encodeURIComponent(nodeKey)}-${exampleIndex}.png`,
  width: 1440,
  height: 900,
  capturedAt: "2026-10-08T09:30:00.000Z",
  ...extra,
});

function rawInput(overrides: Partial<RawInput> = {}): RawInput {
  return {
    title: "Design onboarding",
    tree: {
      window: { from: "2026-10-01", to: "2026-10-07" },
      app: "design",
      rootN: 1000,
      coverage: {
        sessionsWithEvents: 1000,
        sessionsWithReplay: 400,
        truncated: false,
      },
      nodes: [
        node("signup", null, 1000, { dropoffN: 340, dropoffPct: 34 }),
        node("signup > prompt", "signup", 500, { pctOfParent: 50 }),
        node("signup > skip", "signup", 160, { pctOfParent: 16 }),
        node("signup > skip > editor", "signup > skip", 100, {
          pctOfParent: 62.5,
          dropoffN: 10,
          dropoffPct: 10,
        }),
        {
          ...node("signup > other", "signup", 40, { pctOfParent: 4 }),
          kind: "other",
          label: "Other (3 branches)",
          examples: [],
        },
      ],
    },
    frames: [
      frame("signup", 0, { width: 1440, height: 900 }),
      frame("signup", 1),
      frame("signup > prompt", 0, { width: 390, height: 844 }),
      frame("signup > skip > editor", 0),
    ],
    ...overrides,
  };
}

const parse = (raw: RawInput) => createJourneyCanvasInputSchema.parse(raw);
const plan = (raw: RawInput = rawInput()) =>
  planJourneyCanvas(parse(raw), "design-1");

function problems(raw: unknown): string[] {
  const result = createJourneyCanvasInputSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
}

describe("create-journey-canvas input", () => {
  it("plans up to 500 journey nodes and rejects larger trees", () => {
    const root = node("root", null, 1000);
    const nodes = [
      root,
      ...Array.from({ length: 499 }, (_, index) =>
        node(`root > branch-${index}`, "root", 1),
      ),
    ];
    const raw = rawInput({
      includeScreenshotless: true,
      frames: [],
      tree: { ...rawInput().tree, nodes },
    });

    expect(planJourneyCanvas(parse(raw), "design-1").nodeCount).toBe(500);
    const oversized = createJourneyCanvasInputSchema.safeParse({
      ...raw,
      tree: {
        ...raw.tree,
        nodes: [...nodes, node("root > overflow", "root", 1)],
      },
    });
    expect(oversized.success).toBe(false);
    if (!oversized.success) {
      expect(oversized.error.issues.map((issue) => issue.path)).toContainEqual([
        "tree",
        "nodes",
      ]);
    }
  });

  it("applies the documented defaults", () => {
    const input: CreateJourneyCanvasInput = parse(rawInput());
    expect(input.cardWidth).toBe(360);
    expect(input.maxExamplesPerNode).toBe(3);
    expect(input.includeScreenshotless).toBe(false);
    expect(input.allowEncryptedPublicUploadFallback).toBe(false);
    expect(input.tree.nodes[0]?.referenceOnly).toBe(false);
  });

  it("accepts an https imageUrl and an attachmentRef", () => {
    expect(problems(rawInput())).toEqual([]);
    const withRef = rawInput({
      frames: [
        {
          nodeKey: "signup",
          exampleIndex: 0,
          attachmentRef: "ref-opaque-1",
          width: 1440,
          height: 900,
          capturedAt: "2026-10-08T09:30:00.000Z",
        },
      ],
    });
    expect(problems(withRef)).toEqual([]);
    const withStagedFrame = rawInput({
      designId: "design-1",
      frames: [
        frame("signup", 0, {
          imageUrl: undefined,
          stagedFrameId: "jcu_opaque-frame-id",
          route: "/home",
        }),
      ],
    });
    expect(problems(withStagedFrame)).toEqual([]);
  });

  it("requires and carries sourceApp for private frames in an all-app tree", () => {
    const base = rawInput();
    const withSourceApp = rawInput({
      tree: { ...base.tree, app: "all" },
      frames: [
        frame("signup", 0, {
          imageUrl: undefined,
          attachmentRef: "ref-opaque-1",
          sourceApp: "chat",
        }),
      ],
    });
    expect(problems(withSourceApp)).toEqual([]);
    expect(
      planJourneyCanvas(parse(withSourceApp), "design-1").screens[0]?.attachment
        ?.sourceApp,
    ).toBe("chat");

    const missingSourceApp = rawInput({
      tree: { ...base.tree, app: "all" },
      frames: [
        frame("signup", 0, {
          imageUrl: undefined,
          attachmentRef: "ref-opaque-1",
        }),
      ],
    });
    expect(problems(missingSourceApp).join("\n")).toMatch(/sourceApp/);

    const mismatchedSourceApp = rawInput({
      frames: [
        frame("signup", 0, {
          imageUrl: undefined,
          attachmentRef: "ref-opaque-1",
          sourceApp: "chat",
        }),
      ],
    });
    expect(problems(mismatchedSourceApp).join("\n")).toMatch(/sourceApp/);
  });

  it("rejects data: and non-https image URLs with a clear message", () => {
    const dataUrl = problems(
      rawInput({
        designId: "design-1",
        frames: [
          frame("signup", 0, { imageUrl: "data:image/png;base64,AAAA" }),
        ],
      }),
    );
    expect(dataUrl.join("\n")).toMatch(/data: URLs are not accepted/);
    const http = problems(
      rawInput({
        frames: [
          frame("signup", 0, { imageUrl: "http://img.example.test/a.png" }),
        ],
      }),
    );
    expect(http.join("\n")).toMatch(
      /must be an https:\/\/ URL, received http:/,
    );
    expect(imageUrlProblem("https://user:pw@img.example.test/a.png")).toMatch(
      /credentials/,
    );
    expect(imageUrlProblem("//img.example.test/a.png")).toMatch(
      /without a scheme/,
    );
  });

  it("requires exactly one image source per frame", () => {
    const neither = problems(
      rawInput({ frames: [frame("signup", 0, { imageUrl: undefined })] }),
    );
    expect(neither.join("\n")).toMatch(
      /exactly one of imageUrl, attachmentRef, or stagedFrameId/,
    );
    const both = problems(
      rawInput({ frames: [frame("signup", 0, { attachmentRef: "ref" })] }),
    );
    expect(both.join("\n")).toMatch(
      /exactly one of imageUrl, attachmentRef, or stagedFrameId/,
    );
    const missingDesign = problems(
      rawInput({
        frames: [
          frame("signup", 0, {
            imageUrl: undefined,
            stagedFrameId: "jcu_opaque-frame-id",
            route: "/home",
          }),
        ],
      }),
    );
    expect(missingDesign.join("\n")).toMatch(
      /Pass the Design ID used to stage/,
    );
  });

  it("maps a staged private frame to the final access-checked screenshot route", () => {
    const input = parse(
      rawInput({
        designId: "design-1",
        frames: [
          frame("signup", 0, {
            imageUrl: undefined,
            stagedFrameId: "jcu_opaque-frame-id",
            route: "/app/settings",
          }),
        ],
      }),
    );
    const result = planJourneyCanvas(input, "design-1");
    const screen = result.screens.find(
      (candidate) => candidate.nodeKey === "signup",
    )!;
    expect(screen.attachment?.stagedFrameId).toBe("jcu_opaque-frame-id");
    expect(screen.attachment?.route).toBe("/app/settings");
    expect(screen.html).toContain(
      `${REPLAY_SCREENSHOT_ROUTE}${screen.attachment!.rowId}`,
    );
    expect(screen.html).not.toContain("jcu_opaque-frame-id");
  });

  it("rejects trees and frames that do not hang together", () => {
    const base = rawInput();
    const duplicate = rawInput({
      tree: {
        ...base.tree,
        nodes: [...base.tree.nodes, node("signup", null, 1)],
      },
    });
    expect(problems(duplicate).join("\n")).toMatch(
      /Duplicate node key "signup"/,
    );

    const orphan = rawInput({
      tree: { ...base.tree, nodes: [node("a", "ghost", 1)] },
    });
    expect(problems(orphan).join("\n")).toMatch(/missing parent "ghost"/);

    const cycle = rawInput({
      tree: { ...base.tree, nodes: [node("a", "b", 1), node("b", "a", 1)] },
    });
    expect(problems(cycle).join("\n")).toMatch(/parent cycle/);

    expect(
      problems(rawInput({ frames: [frame("nope", 0)] })).join("\n"),
    ).toMatch(/unknown node "nope"/);
    expect(
      problems(rawInput({ frames: [frame("signup", 5)] })).join("\n"),
    ).toMatch(/exampleIndex 5 is out of range/);
    expect(
      problems(
        rawInput({ frames: [frame("signup", 0), frame("signup", 0)] }),
      ).join("\n"),
    ).toMatch(/Duplicate frame/);
  });

  it("converts to the JSON Schema an MCP tool listing publishes", () => {
    const schema = toJSONSchema(createJourneyCanvasInputSchema, {
      io: "input",
    }) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required.sort()).toEqual(["frames", "title", "tree"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "allowEncryptedPublicUploadFallback",
      "cardWidth",
      "designId",
      "frames",
      "includeScreenshotless",
      "locale",
      "maxExamplesPerNode",
      "title",
      "tree",
    ]);
    expect(JSON.stringify(schema.properties.tree)).toContain("referenceOnly");
  });

  it("allows reference-only step nodes without cohort metrics", () => {
    const base = rawInput();
    const observed = referenceNode("signup > Skip", "signup", 2, [
      example("skip", 1440, 900),
    ]);
    const parsed = parse({
      ...base,
      tree: { ...base.tree, nodes: [base.tree.nodes[0]!, observed] },
      frames: [frame("signup", 0), frame(observed.key, 0)],
    });

    expect(parsed.tree.nodes[1]).toMatchObject({
      key: observed.key,
      kind: "step",
      referenceOnly: true,
      examples: observed.examples,
    });
    expect("n" in parsed.tree.nodes[1]!).toBe(false);
    expect(
      problems({
        ...base,
        tree: {
          ...base.tree,
          nodes: [{ ...base.tree.nodes[0]!, n: undefined }],
        },
      }).join("\n"),
    ).toContain("n");
  });

  it("bounds sizes", () => {
    expect(problems(rawInput({ cardWidth: 100 })).length).toBeGreaterThan(0);
    expect(
      problems(rawInput({ maxExamplesPerNode: 0 })).length,
    ).toBeGreaterThan(0);
    expect(
      problems(rawInput({ frames: [frame("signup", 0, { width: 0 })] })).length,
    ).toBeGreaterThan(0);
  });
});

describe("journey canvas direction", () => {
  it("marks Arabic cards as right-to-left documents", () => {
    const input = parse(rawInput({ locale: "ar-SA" }));
    const result = planJourneyCanvas(input, "design-1", arSA.journeyCanvas);

    expect(result.screens[0]?.html).toMatch(
      /<html lang="ar-SA" dir="rtl"(?:\s|>)/,
    );
  });
});

describe("planJourneyCanvas", () => {
  it("renders a card per node with a frame, stubs for last-observed steps and other, and lists the rest", () => {
    const result = plan();
    expect(result.nodeCount).toBe(4);
    expect(result.frameCount).toBe(4);
    expect(result.skippedNodes).toEqual([
      { key: "signup > skip", reason: "No screenshot captured." },
    ]);
    expect(result.screens.map((screen) => screen.nodeKey).sort()).toEqual([
      "signup",
      "signup",
      "signup > prompt",
      "signup > skip > editor",
    ]);
  });

  it("keeps concatenated journey roots grouped in their input order", () => {
    const raw = rawInput();
    const roots = [
      {
        root: node("Clips", null, 600),
        child: node("Clips > next", "Clips", 550),
      },
      {
        root: node("Design", null, 800),
        child: node("Design > next", "Design", 700),
      },
      {
        root: node("Slides", null, 1000),
        child: node("Slides > next", "Slides", 900),
      },
    ];
    raw.tree.nodes = roots.flatMap(({ root, child }) => [root, child]);
    raw.frames = roots.flatMap(({ root, child }) => [
      frame(root.key, 0),
      frame(child.key, 0),
    ]);

    const { screens } = plan(raw);
    const y = (key: string) =>
      screens.find((screen) => screen.nodeKey === key)!.frame.y;

    expect(y("Clips")).toBeLessThan(y("Design"));
    expect(y("Clips > next")).toBeLessThan(y("Design"));
    expect(y("Design")).toBeLessThan(y("Slides"));
    expect(y("Design > next")).toBeLessThan(y("Slides"));
  });

  it("never drops a frame passed for an other node: it is rejected without examples and drawn as a card with them", () => {
    const withOther = (examples: ReturnType<typeof example>[]) => {
      const raw = rawInput();
      const other = raw.tree.nodes.find((entry) => entry.kind === "other")!;
      other.examples = examples;
      raw.frames = [...raw.frames, frame("signup > other", 0)];
      return raw;
    };
    expect(problems(withOther([])).join("\n")).toMatch(/signup > other/);
    const drawn = plan(withOther([example("other-1")]));
    expect(
      drawn.screens.some((screen) => screen.nodeKey === "signup > other"),
    ).toBe(true);
    expect(
      drawn.skippedNodes.some((skipped) => skipped.key === "signup > other"),
    ).toBe(false);
  });

  it("gives every screen a deterministic, prefixed id and filename", () => {
    const first = plan();
    const second = plan();
    expect(second.screens.map((s) => s.fileId)).toEqual(
      first.screens.map((s) => s.fileId),
    );
    expect(new Set(first.screens.map((s) => s.fileId)).size).toBe(
      first.screens.length,
    );
    for (const screen of first.screens) {
      expect(screen.fileId.startsWith(JOURNEY_FILE_ID_PREFIX)).toBe(true);
      expect(screen.filename.startsWith(JOURNEY_FILENAME_PREFIX)).toBe(true);
      expect(screen.filename).not.toMatch(/[/\\]|\.\./);
    }
    const other = planJourneyCanvas(parse(rawInput()), "design-2");
    expect(other.screens[0]!.fileId).not.toBe(first.screens[0]!.fileId);
  });

  it("numbers filenames in reading order and titles only the front card of a stack", () => {
    const { screens } = plan();
    const byName = (name: string) => screens.find((s) => s.filename === name)!;
    expect(byName("journey-1-signup.html").title).toBe("signup");
    expect(byName("journey-1-signup-ex2.html").title).toBe("");
    expect(byName("journey-2-signup-prompt.html").title).toBe(
      "signup > prompt",
    );
    expect(new Set(screens.map((s) => s.filename)).size).toBe(screens.length);
  });

  it("writes a header with label, session count and percent, and an img with the https URL", () => {
    const prompt = plan().screens.find((s) => s.nodeKey === "signup > prompt")!;
    expect(prompt.html).toMatch(/<h1[^>]*>signup &gt; prompt<\/h1>/);
    expect(prompt.html).toContain("500 sessions · 50% of previous");
    expect(prompt.html).toContain(
      'src="https://img.example.test/signup%20%3E%20prompt-0.png"',
    );
    expect(prompt.html).toContain("object-fit:contain");
    const root = plan().screens.find((s) => s.nodeKey === "signup")!;
    expect(root.html).toContain("1,000 sessions · 100% of all");
  });

  it("shows original example provenance separately from screenshot capture time", () => {
    const root = plan().screens.find((s) => s.nodeKey === "signup")!;
    expect(root.provenance).toEqual({
      eventAt: "2026-10-01T12:00:00.000Z",
      dateLabel: "Event time (UTC)",
      recordingId: "rec-signup-1",
      offsetMs: 4_000,
      offsetIsObserved: false,
      checkpointOffsetMs: 4_000,
      replayObservedAt: null,
      screenshotCapturedAt: "2026-10-08T09:30:00.000Z",
    });
    expect(root.html).toContain("Event time (UTC) 2026-10-01T12:00:00.000Z");
    expect(root.html).toContain("Recording ID rec-signup-1");
    expect(root.html).toContain("Replay offset 4,000 ms");
    expect(root.html).toContain("Screenshot captured 2026-10-08");
    expect(root.frame.height).toBe(
      CARD_PROVENANCE_HEADER_HEIGHT + 20 + 12 + 225,
    );
  });

  it("shows the replay screenshot offset and observation time separately from its source event", () => {
    const result = plan(
      rawInput({
        designId: "design-1",
        frames: [
          frame("signup", 0, {
            imageUrl: undefined,
            stagedFrameId: "jcu_replay-offset",
            route: "/home",
            screenshotOffsetMs: 4_600,
            recordingStartedAt: "2026-10-01T11:59:56.000Z",
          }),
        ],
      }),
    );
    const root = result.screens.find((screen) => screen.nodeKey === "signup")!;

    expect(root.provenance).toMatchObject({
      eventAt: "2026-10-01T12:00:00.000Z",
      offsetMs: 4_600,
      offsetIsObserved: true,
      checkpointOffsetMs: 4_000,
      replayObservedAt: "2026-10-01T12:00:00.600Z",
    });
    expect(root.attachment?.offsetMs).toBe(4_600);
    expect(root.html).toContain("Replay offset 4,600 ms");
    expect(root.html).not.toContain("Checkpoint seek target 4,000 ms");
    expect(root.html).toContain("Analytics checkpoint offset 4,000 ms");
    expect(root.html).toContain("Replay observed 2026-10-01T12:00:00.600Z UTC");
    expect(root.frame.height).toBe(
      CARD_PROVENANCE_HEADER_HEIGHT + 20 + 12 + 225,
    );
  });

  it("reserves header space when the observed replay time adds a provenance row", () => {
    const checkpointFrame = frame("signup", 0, { screenshotOffsetMs: 4_000 });
    const observedFrame = frame("signup", 0, {
      screenshotOffsetMs: 4_000,
      recordingStartedAt: "2026-10-01T11:59:56.300Z",
    });
    const checkpoint = plan(
      rawInput({ frames: [checkpointFrame] }),
    ).screens.find((screen) => screen.nodeKey === "signup")!;
    const observed = plan(rawInput({ frames: [observedFrame] })).screens.find(
      (screen) => screen.nodeKey === "signup",
    )!;

    expect(observed.provenance?.replayObservedAt).toBe(
      "2026-10-01T12:00:00.300Z",
    );
    expect(observed.html).toContain(
      "Replay observed 2026-10-01T12:00:00.300Z UTC",
    );
    expect(observed.frame.height).toBe(checkpoint.frame.height + 10);
  });

  it("counts the recording label when a long ID wraps in the provenance row", () => {
    const base = rawInput();
    const root = base.tree.nodes[0]!;
    const longRoot = {
      ...root,
      examples: root.examples.map((example, index) =>
        index === 0 ? { ...example, recordingId: "r".repeat(48) } : example,
      ),
    };
    const tree = {
      ...base.tree,
      nodes: [longRoot, ...base.tree.nodes.slice(1)],
    };
    const frames = [frame("signup", 0, { screenshotOffsetMs: 4_600 })];
    const shortId = plan(rawInput({ cardWidth: 320, frames })).screens.find(
      (screen) => screen.nodeKey === "signup",
    )!;
    const longId = plan(
      rawInput({ cardWidth: 320, tree, frames }),
    ).screens.find((screen) => screen.nodeKey === "signup")!;

    expect(longId.html).toContain(`Recording ID ${"r".repeat(48)}`);
    expect(longId.frame.height).toBe(shortId.frame.height + 10);
  });

  it("labels cohort sessions that continue beyond pictured child paths", () => {
    const base = rawInput();
    const nodes = [...base.tree.nodes];
    nodes[0] = node("signup", null, 1000, {
      dropoffN: 100,
      dropoffPct: 10,
    });
    const result = plan(rawInput({ tree: { ...base.tree, nodes } }));
    const root = result.screens.find((screen) => screen.nodeKey === "signup")!;

    expect(root.html).toContain(
      "260 continued on unpictured paths · 26% of this step",
    );
    expect(root.html).toContain("header .coverage-note");
    expect(root.frame.height).toBe(
      CARD_PROVENANCE_HEADER_HEIGHT + 20 + 12 + 225,
    );
  });

  it("renders a chronological reference chain without inventing cohort metrics", () => {
    const base = rawInput();
    const exampleAt = (sessionId: string, ts: string, offsetMs: number) => ({
      ...example(sessionId),
      ts,
      offsetMs,
    });
    const nodes = [
      node("signup", null, 1000, {
        examples: [exampleAt("root", "2026-10-08T09:59:00.000Z", 1_000)],
      }),
      referenceNode("signup > Skip", "signup", 2, [
        exampleAt("skip", "2026-10-08T10:00:00.000Z", 2_000),
      ]),
      referenceNode("signup > Skip > Library", "signup > Skip", 3, [
        exampleAt("library-1", "2026-10-08T10:01:00.000Z", 3_000),
        exampleAt("library-2", "2026-10-08T10:02:00.000Z", 4_000),
      ]),
      referenceNode(
        "signup > Skip > Library > RecordaClip",
        "signup > Skip > Library",
        4,
        [exampleAt("recordaclip", "2026-10-08T10:03:00.000Z", 5_000)],
      ),
      referenceNode(
        "signup > Skip > Library > RecordaClip > Connectstorage",
        "signup > Skip > Library > RecordaClip",
        5,
        [exampleAt("connectstorage", "2026-10-08T10:04:00.000Z", 6_000)],
      ),
    ];
    const referenceFrames = nodes.slice(1).flatMap((journeyNode, nodeIndex) =>
      journeyNode.examples.map((_, exampleIndex) =>
        frame(journeyNode.key, exampleIndex, {
          capturedAt: `2026-10-08T10:${String(10 + nodeIndex * 2 + exampleIndex).padStart(2, "0")}:00.000Z`,
        }),
      ),
    );
    const result = plan(
      rawInput({
        tree: { ...base.tree, nodes },
        frames: [frame("signup", 0), ...referenceFrames.reverse()],
      }),
    );

    for (const journeyNode of nodes.slice(1)) {
      const screen = result.screens.find(
        (candidate) =>
          candidate.nodeKey === journeyNode.key && candidate.exampleIndex === 0,
      )!;
      expect(screen.html).toMatch(
        /<p class="metrics"[^>]*>Observed session reference<\/p>/,
      );
      expect(screen.html).not.toContain(" sessions · ");
      expect(screen.provenance?.eventAt).toBe(journeyNode.examples[0]?.ts);
      expect(screen.provenance?.recordingId).toBe(
        journeyNode.examples[0]?.recordingId,
      );
      expect(screen.provenance?.offsetMs).toBe(
        journeyNode.examples[0]?.offsetMs,
      );
      expect(screen.html).toContain("Screenshot captured 2026-10-08");
    }
    const libraryFrames = result.screens
      .filter((screen) => screen.nodeKey === "signup > Skip > Library")
      .sort((a, b) => a.exampleIndex - b.exampleIndex);
    const orderedReferenceScreens = result.screens.filter(
      (screen) => screen.nodeKey !== "signup",
    );
    expect(
      orderedReferenceScreens.map((screen) => screen.provenance?.eventAt),
    ).toEqual([
      "2026-10-08T10:00:00.000Z",
      "2026-10-08T10:01:00.000Z",
      "2026-10-08T10:02:00.000Z",
      "2026-10-08T10:03:00.000Z",
      "2026-10-08T10:04:00.000Z",
    ]);
    expect(
      orderedReferenceScreens.map(
        (screen) => screen.provenance?.screenshotCapturedAt,
      ),
    ).toEqual([
      "2026-10-08T10:10:00.000Z",
      "2026-10-08T10:12:00.000Z",
      "2026-10-08T10:13:00.000Z",
      "2026-10-08T10:14:00.000Z",
      "2026-10-08T10:16:00.000Z",
    ]);
    expect(
      libraryFrames.map((screen) => screen.provenance?.recordingId),
    ).toEqual(["rec-library-1", "rec-library-2"]);
    const board = result.boardFragments({ x: 0, y: 0 }).join("\n");
    expect(board.match(/data-an-primitive="arrow"/g)).toHaveLength(4);
    expect(board).not.toContain("Journey edge label");
    expect(board).not.toContain("No later step observed");
  });

  it("shows frame captions and lets readers switch examples in place", () => {
    const base = rawInput();
    const outputKey = "signup > output reference";
    const observed = referenceNode(outputKey, "signup", 2, [
      {
        ...example("output-1"),
        ts: "2026-10-01T17:49:59.308Z",
        offsetMs: 400_000,
      },
      {
        ...example("output-2"),
        ts: "2026-10-01T17:51:39.308Z",
        offsetMs: 500_000,
      },
    ]);
    const attachedFrame = (
      exampleIndex: number,
      caption: RawInput["frames"][number]["caption"],
    ): RawInput["frames"][number] => ({
      nodeKey: outputKey,
      exampleIndex,
      attachmentRef: `attachment:v1:private-${exampleIndex}`,
      width: 1470,
      height: 753,
      capturedAt: `2026-10-08T22:03:0${exampleIndex}.000Z`,
      caption,
    });
    const result = plan(
      rawInput({
        tree: {
          ...base.tree,
          nodes: [base.tree.nodes[0]!, observed],
        },
        frames: [
          frame("signup", 0),
          attachedFrame(0, {
            outputTitle: "Case-management prototype",
            observedState: "Prompt is visible before generation.",
            actor: "first-actor@example.test",
            actorSource: "recording metadata",
            dateLabel: "Replay observation (UTC)",
            evidenceStatus: "rendered_output_observed",
            prompt: "Build a <test> prototype.",
            promptTranslation: "Build a prototype.",
            promptSource: "reviewed replay prompt",
          }),
          attachedFrame(1, {
            outputTitle: "Create test case modal",
            observedState: "The first output is visible.",
            actor: "second-actor@example.test",
            actorSource: "recording metadata",
            dateLabel: "Event time (UTC)",
            evidenceStatus: "rendered_output_observed",
            prompt: "Create a modal for test cases.",
            promptSource: "reviewed replay prompt",
          }),
        ],
      }),
    );
    const screens = result.screens
      .filter((screen) => screen.nodeKey === outputKey)
      .sort((a, b) => a.exampleIndex - b.exampleIndex);
    const html = screens[0]?.html ?? "";
    const exampleHeader = (index: number) =>
      new RegExp(
        `<section class="example-provenance" data-index="${index}"[^>]*>([\\s\\S]*?)</section>`,
      ).exec(html)?.[1] ?? "";

    expect(screens).toHaveLength(2);
    expect(exampleHeader(0)).toContain(
      "Replay observation (UTC) 2026-10-01T17:49:59.308Z",
    );
    expect(exampleHeader(0)).toContain(
      'title="UTC timestamp: 2026-10-01T17:49:59.308Z"',
    );
    expect(exampleHeader(0)).toContain(
      "Actor (recording): first-actor@example.test",
    );
    expect(exampleHeader(0)).toContain("Prompt is visible before generation.");
    expect(exampleHeader(0)).toContain("Prompt: Build a prototype.");
    expect(exampleHeader(0)).toContain("Build a &lt;test&gt; prototype.");
    expect(exampleHeader(1)).toContain(
      "Replay observation (UTC) 2026-10-01T17:51:39.308Z",
    );
    expect(exampleHeader(1)).toContain(
      'title="UTC timestamp: 2026-10-01T17:51:39.308Z"',
    );
    expect(exampleHeader(1)).toContain(
      "Actor (recording): second-actor@example.test",
    );
    expect(exampleHeader(1)).toContain("The first output is visible.");
    expect(exampleHeader(1)).toContain(
      "Prompt: Create a modal for test cases.",
    );
    expect(screens[0]?.html).toMatch(
      /:checked~header \.example-provenance\[data-index="1"\]\{display:block\}/,
    );
    expect(screens[0]?.html).toMatch(
      /:checked~main \.example-frame\[data-index="1"\]\{display:flex\}/,
    );
    expect(screens[0]?.html).toContain("Example 1 of 2");
    expect(screens[0]?.html).toContain("Example 2 of 2");
    expect(screens[0]?.html).toMatch(
      /aria-label="Show example 1 of 2" checked/,
    );
    expect(screens[0]?.html).toContain("/api/design-board-replay-screenshots/");
    expect(screens[0]?.html).toMatch(/aria-label="Show example 2 of 2"[^>]*>/);
    expect(screens[1]?.html).toMatch(
      /aria-label="Show example 2 of 2" checked/,
    );
    expect(screens[0]?.html).not.toContain("storageOwnerEmail");
    expect(screens[0]?.provenance?.screenshotCapturedAt).toBe(
      "2026-10-08T22:03:00.000Z",
    );
  });

  it("keeps the full card heading available when the canvas ellipsizes it", () => {
    const base = rawInput();
    const title =
      "A long observed settings handoff heading with details that exceed the card width & remain readable";
    const result = plan(
      rawInput({
        tree: {
          ...base.tree,
          nodes: base.tree.nodes.map((candidate) =>
            candidate.key === "signup"
              ? { ...candidate, label: title }
              : candidate,
          ),
        },
      }),
    );
    const html = result.screens.find(
      (screen) => screen.nodeKey === "signup",
    )?.html;
    const escapedTitle = title.replace(/&/g, "&amp;");

    expect(html).toContain('title="' + escapedTitle + '"');
    expect(html).toContain(">" + escapedTitle + "</h1>");
  });

  it("shows a completion event timestamp separately from the replay image time", () => {
    const base = rawInput();
    const outputKey = "signup > completed output";
    const observed = referenceNode(outputKey, "signup", 2, [
      {
        ...example("completed-output"),
        ts: "2026-09-28T15:07:06.840-07:00",
        offsetMs: 545_313,
      },
    ]);
    const result = plan(
      rawInput({
        tree: { ...base.tree, nodes: [base.tree.nodes[0]!, observed] },
        frames: [
          frame("signup", 0),
          {
            nodeKey: outputKey,
            exampleIndex: 0,
            attachmentRef: "attachment:v1:completed-output",
            width: 1536,
            height: 826,
            capturedAt: "2026-10-08T15:17:00.000-07:00",
            caption: {
              outputTitle: "A comfort routine with measurable potential",
              actor: "actor@example.test",
              actorSource: "recording user identity",
              dateLabel: "Replay observation (UTC)",
              evidenceStatus: "generation_completed",
              evidenceAt: "2026-09-28T15:07:01.840-07:00",
              prompt: "Create a six-slide deck.",
              promptSource: "recorded composer DOM text",
            },
          },
        ],
      }),
    );
    const screen = result.screens.find((item) => item.nodeKey === outputKey)!;

    expect(screen.html).toContain(
      "Replay observation (UTC) 2026-09-28T22:07:06.840Z",
    );
    expect(screen.html).toContain(
      'title="UTC timestamp: 2026-09-28T22:07:06.840Z"',
    );
    expect(screen.html).toContain(
      "Evidence: generation_completed event (2026-09-28T22:07:01.840Z UTC)",
    );
    expect(screen.html).toContain("Screenshot captured 2026-10-08 UTC");
    expect(screen.html).toContain("Actor (recording): actor@example.test");
    expect(screen.frame.height).toBe(
      CARD_PROVENANCE_HEADER_HEIGHT + 48 + Math.round(360 / (1536 / 826)),
    );
  });

  it("never inlines image bytes", () => {
    for (const screen of plan().screens) {
      expect(screen.html).not.toMatch(/data:|base64/i);
    }
  });

  it("sizes each card from the frame's real aspect ratio at a fixed width", () => {
    const { screens } = plan();
    const root = screens.find(
      (s) => s.nodeKey === "signup" && s.exampleIndex === 0,
    )!;
    const mobile = screens.find((s) => s.nodeKey === "signup > prompt")!;
    expect(root.frame.width).toBe(360);
    expect(root.frame.height).toBe(
      CARD_PROVENANCE_HEADER_HEIGHT + 20 + 12 + 225,
    );
    expect(mobile.frame.width).toBe(360);
    expect(mobile.frame.height).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 12 + 720);
    expect(mobile.html).toContain(
      "500 continued on unpictured paths · 100% of this step",
    );
    const wide = plan(
      rawInput({ frames: [frame("signup", 0, { width: 5000, height: 500 })] }),
    ).screens[0]!;
    expect(wide.frame.height).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 12 + 180);
  });

  it("stacks extra examples behind the front card", () => {
    const { screens } = plan();
    const front = screens.find(
      (s) => s.nodeKey === "signup" && s.exampleIndex === 0,
    )!;
    const behind = screens.find(
      (s) => s.nodeKey === "signup" && s.exampleIndex === 1,
    )!;
    expect(behind.frame.x).toBe(front.frame.x);
    expect(behind.frame.y).toBe(front.frame.y + 10);
    expect(behind.frame.z).toBeLessThan(front.frame.z);
  });

  it("ignores frames beyond maxExamplesPerNode and says so for nodes left empty", () => {
    const result = plan(rawInput({ maxExamplesPerNode: 1 }));
    expect(result.screens.filter((s) => s.nodeKey === "signup")).toHaveLength(
      1,
    );
    const onlyLate = plan(
      rawInput({ maxExamplesPerNode: 1, frames: [frame("signup", 1)] }),
    );
    expect(
      onlyLate.skippedNodes.find((s) => s.key === "signup")?.reason,
    ).toMatch(/maxExamplesPerNode \(1\)/);
  });

  it("re-attaches the children of a skipped node to the nearest rendered ancestor", () => {
    const fragments = plan().boardFragments({ x: 0, y: 0 }).join("\n");
    expect(fragments.match(/stroke-dasharray="6 6"/g)).toHaveLength(1);
    const editor = plan().screens.find(
      (s) => s.nodeKey === "signup > skip > editor",
    )!;
    expect(editor.html).toContain("100 sessions · 10% of signup");
  });

  it("renders screenshotless steps only when asked", () => {
    const result = plan(rawInput({ includeScreenshotless: true }));
    expect(result.skippedNodes).toEqual([]);
    const placeholder = result.screens.find(
      (s) => s.nodeKey === "signup > skip",
    )!;
    expect(placeholder.html).toContain("No screenshot captured");
    expect(placeholder.html).not.toContain("<img");
    expect(placeholder.exampleIndex).toBe(-1);
    expect(result.frameCount).toBe(4);
  });

  it("draws arrows, fork percentages, last-observed-step and other stubs, a date line and a title on the board", () => {
    const html = plan().boardFragments({ x: 100, y: 200 }).join("\n");
    expect(html).toContain("No later step observed");
    expect(html).toContain("340 sessions · 34% of this step");
    expect(html).toContain("10 sessions · 10% of this step");
    expect(html).toContain("Other (3 branches)");
    expect(html).toContain("Captured 2026-10-08 · 2 examples");
    expect(html).toContain("Design onboarding");
    expect(html).not.toContain("partial sample");
    expect(html).toContain(">50%<");
    expect(
      html.match(/data-an-primitive="arrow"/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    for (const id of html.matchAll(/data-agent-native-node-id="([^"]+)"/g)) {
      expect(id[1]!.startsWith(JOURNEY_BOARD_ID_PREFIX)).toBe(true);
    }
    const truncated = rawInput();
    truncated.tree.coverage.truncated = true;
    expect(plan(truncated).boardFragments({ x: 0, y: 0 }).join("\n")).toContain(
      "partial sample",
    );
  });

  it("points private attachments at the authenticated replay-screenshot route", () => {
    const result = plan(
      rawInput({
        frames: [
          {
            nodeKey: "signup",
            exampleIndex: 0,
            attachmentRef: "ref-opaque-1",
            width: 1440,
            height: 900,
            capturedAt: "2026-10-08T09:30:00.000Z",
          },
        ],
      }),
    );
    const screen = result.screens[0]!;
    expect(screen.attachment).toMatchObject({
      ref: "ref-opaque-1",
      replayId: "rec-signup-1",
      offsetMs: 4_000,
      width: 1440,
      height: 900,
    });
    expect(screen.html).toContain(
      `src="${REPLAY_SCREENSHOT_ROUTE}${screen.attachment!.rowId}"`,
    );
    expect(screen.html).not.toContain("ref-opaque-1");
    expect(screen.html).not.toContain("referrerpolicy");
  });

  it("escapes labels and titles", () => {
    const raw = rawInput({ title: '<script>alert("x")</script>' });
    raw.tree.nodes[0]!.label = '<img src=x onerror="boom">';
    const result = plan(raw);
    expect(result.screens[0]!.html).not.toContain("<img src=x");
    expect(result.boardFragments({ x: 0, y: 0 }).join("")).not.toContain(
      "<script>",
    );
  });

  it("translates board fragments to the canvas origin", () => {
    const at = (x: number, y: number) =>
      plan()
        .boardFragments({ x, y })
        .find((f) => f.includes("jc-title"))!;
    expect(at(0, 0)).toContain("left:0px;top:-72px");
    expect(at(500, 1000)).toContain("left:500px;top:928px");
  });
});

describe("replaceJourneyBoardObjects", () => {
  const foreign =
    '<div data-agent-native-node-id="user-1" data-an-primitive="rectangle" style="position:absolute;left:5px;top:5px;width:10px;height:10px"></div>';

  it("is idempotent and leaves foreign board objects byte-for-byte alone", () => {
    const fragments = plan().boardFragments({ x: 0, y: 0 });
    const base = emptyBoardHtml().replace("</body>", `${foreign}\n</body>`);
    const once = replaceJourneyBoardObjects(base, fragments);
    const twice = replaceJourneyBoardObjects(once, fragments);
    expect(twice).toBe(once);
    expect(once).toContain(foreign);
    expect(once.match(/data-agent-native-node-id="jc-title"/g)).toHaveLength(1);
  });

  it("removes stale journey objects when the tree changes", () => {
    const first = replaceJourneyBoardObjects(
      emptyBoardHtml(),
      plan().boardFragments({ x: 0, y: 0 }),
    );
    expect(first).toContain("No later step observed");
    const smaller = rawInput();
    smaller.tree.nodes[0] = node("signup", null, 1000, {
      dropoffN: 0,
      dropoffPct: 0,
    });
    const second = replaceJourneyBoardObjects(
      first,
      plan(smaller).boardFragments({ x: 0, y: 0 }),
    );
    expect(second).not.toContain("340 sessions · 34% of this step");
    expect(second).toContain("jc-title");
  });
});

describe("formatPercent", () => {
  it("keeps one decimal below 10% and rounds above", () => {
    expect(formatPercent(4.25)).toBe("4.3%");
    expect(formatPercent(49.6)).toBe("50%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });
});
