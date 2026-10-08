import { describe, expect, it } from "vitest";
import { toJSONSchema, type z } from "zod";

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
  extra: Partial<RawInput["tree"]["nodes"][number]> = {},
): RawInput["tree"]["nodes"][number] {
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
  it("applies the documented defaults", () => {
    const input: CreateJourneyCanvasInput = parse(rawInput());
    expect(input.cardWidth).toBe(360);
    expect(input.maxExamplesPerNode).toBe(3);
    expect(input.includeScreenshotless).toBe(false);
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
  });

  it("rejects data: and non-https image URLs with a clear message", () => {
    const dataUrl = problems(
      rawInput({
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
      /exactly one of imageUrl or attachmentRef/,
    );
    const both = problems(
      rawInput({ frames: [frame("signup", 0, { attachmentRef: "ref" })] }),
    );
    expect(both.join("\n")).toMatch(/exactly one of imageUrl or attachmentRef/);
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
      "cardWidth",
      "designId",
      "frames",
      "includeScreenshotless",
      "maxExamplesPerNode",
      "title",
      "tree",
    ]);
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
      recordingId: "rec-signup-1",
      offsetMs: 4_000,
      screenshotCapturedAt: "2026-10-08T09:30:00.000Z",
    });
    expect(root.html).toContain("Event date 2026-10-01");
    expect(root.html).toContain("Recording ID rec-signup-1");
    expect(root.html).toContain("Replay offset 4,000 ms");
    expect(root.html).toContain("Screenshot captured 2026-10-08");
    expect(root.frame.height).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 225);
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
    expect(root.frame.height).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 225);
    expect(mobile.frame.width).toBe(360);
    expect(mobile.frame.height).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 720);
    const wide = plan(
      rawInput({ frames: [frame("signup", 0, { width: 5000, height: 500 })] }),
    ).screens[0]!;
    expect(wide.frame.height).toBe(CARD_PROVENANCE_HEADER_HEIGHT + 180);
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
    smaller.tree.nodes[0]!.dropoffN = 0;
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
