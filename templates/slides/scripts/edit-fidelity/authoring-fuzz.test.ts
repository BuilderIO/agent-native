import { expect, it } from "vitest";

import {
  assertAuthoringPersistence,
  assertByteIdenticalHtml,
  assertShortcutMarkupAdded,
  assertSlideIsScaled,
  AUTHORING_FUZZ_STYLE_PROPERTIES,
  authoringFuzzLineNavigationKeys,
  authoringFuzzProfileIndex,
  canonicalizeAuthoringFuzzPersistence,
  createAuthoringFuzzPlan,
  formatAuthoringFuzzFailure,
  isCaretScrollOnlyChange,
  lineNavigationKeys,
  outsideAuthoringChangesFor,
  runAuthoringFuzz,
} from "./authoring-fuzz.ts";
import type { Snapshot } from "./lib/in-page.ts";

it("requires a markdown shortcut to add its result markup", () => {
  expect(() => assertShortcutMarkupAdded("bullet", 0, 1)).not.toThrow();
  expect(() => assertShortcutMarkupAdded("bullet", 1, 1)).toThrow(
    "markdown shortcut did not produce bullet",
  );
});

const authoringSnapshot = (
  y: number,
  color: string,
  props: Record<string, string> = {},
): Snapshot => ({
  records: [
    {
      key: "box:div#0",
      kind: "box",
      inside: false,
      props: { color, ...props },
      rect: { x: 0, y, width: 100, height: 80 },
    },
  ],
  inventory: { elements: 1, visible: 1, hidden: 0, svg: 0, img: 0, style: 0 },
  text: "",
  editedRect: null,
  editedBoxRect: null,
  editedText: null,
});

const protectedMarkerSnapshot = (
  className: string,
  inlineStyle: string,
  props: Record<string, string>,
  protectedStructure = false,
): Snapshot => ({
  ...authoringSnapshot(64, "rgb(0, 0, 0)"),
  records: [
    {
      key: "box:span#0",
      kind: "box",
      inside: true,
      protectedStyle: true,
      ...(protectedStructure ? { protectedStructure: true } : {}),
      className,
      inlineStyle,
      props,
      rect: { x: 0, y: 0, width: 12, height: 12 },
    },
  ],
});

it("gates outside style changes and unmodeled geometry changes", () => {
  const movement = outsideAuthoringChangesFor(
    authoringSnapshot(64, "rgb(0, 0, 0)"),
    authoringSnapshot(-456, "rgb(0, 0, 0)"),
  );
  expect(movement).toHaveLength(1);
  expect(movement[0]).toMatchObject({ prop: "y", inside: false });
  expect(
    outsideAuthoringChangesFor(
      authoringSnapshot(64, "rgb(0, 0, 0)"),
      authoringSnapshot(64, "rgb(255, 0, 0)"),
    ),
  ).toHaveLength(1);
});

it("tracks computed style properties beyond typography and box paint", () => {
  expect(AUTHORING_FUZZ_STYLE_PROPERTIES).toEqual(
    expect.arrayContaining([
      "filter",
      "position",
      "text-decoration-color",
      "text-decoration-style",
      "text-underline-offset",
      "transform",
      "vertical-align",
    ]),
  );
});

it("gates styled bullet marker restyles inside the edited row", () => {
  const changes = outsideAuthoringChangesFor(
    protectedMarkerSnapshot("marker", "color: red", {
      color: "rgb(255, 0, 0)",
    }),
    protectedMarkerSnapshot("marker-changed", "color: blue", {
      color: "rgb(0, 0, 255)",
    }),
  );

  expect(
    changes.flatMap((change) =>
      "prop" in change ? [{ prop: change.prop, inside: change.inside }] : [],
    ),
  ).toEqual(
    expect.arrayContaining([
      { prop: "class", inside: false },
      { prop: "style", inside: false },
      { prop: "color", inside: false },
    ]),
  );
});

it("gates removal or replacement of a marker the edit must preserve", () => {
  const marker = protectedMarkerSnapshot(
    "marker",
    "color: red",
    { color: "rgb(255, 0, 0)" },
    true,
  );
  const empty = { ...protectedMarkerSnapshot("", "", {}), records: [] };

  expect(outsideAuthoringChangesFor(marker, empty)).toHaveLength(1);
  expect(outsideAuthoringChangesFor(empty, marker)).toHaveLength(1);
});

it("allows a block conversion to remove a marker when the row may change", () => {
  const marker = protectedMarkerSnapshot("marker", "color: red", {
    color: "rgb(255, 0, 0)",
  });
  const empty = { ...protectedMarkerSnapshot("", "", {}), records: [] };

  expect(outsideAuthoringChangesFor(marker, empty)).toHaveLength(0);
});

it("ignores one CSS pixel-quantization step in anchored position styles", () => {
  const before = authoringSnapshot(64, "rgb(0, 0, 0)", {
    top: "386.938px",
    "transform-origin": "135px 74.875px",
    transform: "matrix(1, 0, 0, 1, 0, -74.875)",
  });
  const after = authoringSnapshot(64, "rgb(0, 0, 0)", {
    top: "386.922px",
    "transform-origin": "135px 74.883px",
    transform: "matrix(1, 0, 0, 1, 0, -74.883)",
  });

  expect(outsideAuthoringChangesFor(before, after)).toHaveLength(0);
  expect(
    outsideAuthoringChangesFor(
      before,
      authoringSnapshot(64, "rgb(0, 0, 0)", {
        top: "386.8125px",
        "transform-origin": "135px 74.875px",
        transform: "matrix(1, 0, 0, 1, 0, -74.875)",
      }),
    ),
  ).toHaveLength(1);
});

it.each(["transform", "filter", "position", "--fmd-fit-scale"])(
  "gates outside computed-style changes to %s",
  (property) => {
    const before = authoringSnapshot(64, "rgb(0, 0, 0)", {
      [property]: "before",
    });
    const after = authoringSnapshot(64, "rgb(0, 0, 0)", {
      [property]: "after",
    });

    expect(outsideAuthoringChangesFor(before, after)).toContainEqual(
      expect.objectContaining({ prop: property, inside: false }),
    );
  },
);

it("allows only the matching native caret scroll in an overflowing slide", () => {
  const change = [
    {
      key: "box:div.fmd-autofit-scale#0",
      prop: "y",
      a: "64",
      b: "-300",
    },
  ];
  const options = {
    scrollDelta: 364,
    contentGrew: true,
    containerOverflows: true,
    containerStationary: true,
    fitPositionStylesUnchanged: true,
    fitSizeUnchanged: true,
  };
  expect(isCaretScrollOnlyChange(change, options)).toBe(true);
  expect(
    isCaretScrollOnlyChange(change, { ...options, scrollDelta: 362 }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange([{ ...change[0], b: "-118" }], {
      ...options,
      scrollDelta: 182,
    }),
  ).toBe(true);
  expect(
    isCaretScrollOnlyChange(change, { ...options, contentGrew: false }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, {
      ...options,
      containerOverflows: false,
    }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, {
      ...options,
      containerStationary: false,
    }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, {
      ...options,
      fitPositionStylesUnchanged: false,
    }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(change, { ...options, fitSizeUnchanged: false }),
  ).toBe(false);
  expect(
    isCaretScrollOnlyChange(
      [...change, { key: "box:p#0", prop: "y", a: "0", b: "1" }],
      options,
    ),
  ).toBe(false);
});

function pageAtScale(scale: number) {
  const element = {
    offsetWidth: 100,
    getBoundingClientRect: () => ({ width: scale * 100 }),
  };
  return {
    locator: (selector: string) => ({
      evaluate: (readScale: (element: HTMLElement) => number) =>
        Promise.resolve(readScale(element as HTMLElement)),
      selector,
    }),
  };
}

it("requires corpus authoring output to be changed, saved, and reloaded", () => {
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "edited",
      savedHtml: "edited",
      reloadedHtml: "edited",
    }),
  ).not.toThrow();
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "edited",
      savedHtml: "source",
      reloadedHtml: "source",
    }),
  ).toThrow("authoring flow did not change the persisted slide HTML");
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "source",
      savedHtml: "source",
      reloadedHtml: "source",
    }),
  ).toThrow("authoring flow did not change the persisted slide HTML");
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml: "edited",
      savedHtml: "edited",
      reloadedHtml: "source",
    }),
  ).toThrow("reloaded slide HTML differed from the post-edit live slide");
  expect(() =>
    assertAuthoringPersistence({
      originalHtml: "source",
      liveHtml:
        '<a href="https://example.com" rel="noopener noreferrer" target="_blank">edited</a>',
      savedHtml: '<a href="https://example.com">edited</a>',
      reloadedHtml:
        '<a href="https://example.com" rel="noopener noreferrer" target="_blank">edited</a>',
    }),
  ).not.toThrow();
});

it("canonicalizes every rendered and stored persistence snapshot", async () => {
  const persistence = await canonicalizeAuthoringFuzzPersistence(
    {
      originalHtml: '<p data-slide-text-block="true">before</p>',
      liveHtml: '<p data-slide-text-block="true">after</p>',
      savedHtml: "<p>after</p>",
      reloadedHtml: '<p data-slide-text-block="true">after</p>',
    },
    (html) => html.replaceAll(' data-slide-text-block="true"', ""),
  );
  expect(() => assertAuthoringPersistence(persistence)).not.toThrow();
});

it("requires byte-identical HTML for undo and redo snapshots", () => {
  expect(() =>
    assertByteIdenticalHtml(
      '<p class="a">text</p>',
      '<p class="a">text</p>',
      "undo-all",
    ),
  ).not.toThrow();
  expect(() =>
    assertByteIdenticalHtml(
      '<p class="a b">text</p>',
      '<p class="b a">text</p>',
      "undo-all",
    ),
  ).toThrow("undo-all did not restore byte-identical HTML");
});

it("creates reproducible authoring plans with full command coverage", () => {
  const first = createAuthoringFuzzPlan(42, 500);
  expect(first).toEqual(createAuthoringFuzzPlan(42, 500));
  expect(first).not.toEqual(createAuthoringFuzzPlan(43, 500));
  expect(first).toHaveLength(500);
  expect(
    first.slice(0, 18).map((step) => step.kind === "shortcut" && step.value),
  ).toEqual([
    "- ",
    "* ",
    "+ ",
    "1. ",
    "# ",
    "## ",
    "### ",
    "#### ",
    "> ",
    "--- ",
    "___ ",
    "*** ",
    "**bold**",
    "__bold__",
    "*italic*",
    "_italic_",
    "~~strike~~",
    "`code`",
  ]);
  expect(
    first.slice(18, 26).map((step) => step.kind === "slash" && step.value),
  ).toEqual([
    "paragraph",
    "heading1",
    "heading2",
    "heading3",
    "bulletList",
    "orderedList",
    "quote",
    "divider",
  ]);
  expect(first.slice(26, 61).map((step) => step.kind)).toContain("paste-rich");
  expect(first.map((step) => step.kind)).toContain("quote-exit");
  expect(first.map((step) => step.kind)).toContain("copy-inline");
  expect(() =>
    createAuthoringFuzzPlan(Number.MAX_SAFE_INTEGER + 1, 500),
  ).toThrow("safe integer");
  expect(() => createAuthoringFuzzPlan(42, 0)).toThrow("positive integer");
});

it("runs vertical caret fidelity in the committed absolute profile", () => {
  expect(createAuthoringFuzzPlan(2, 1)).toEqual([
    { kind: "vertical-navigation" },
  ]);
});

it("ends each fuzz plan with an edit after undo and redo operations", () => {
  for (const steps of [51, 52, 61, 500]) {
    for (const seed of [1, 42, 1337]) {
      expect(["undo", "redo", "shortcut-undo", "slash-undo"]).not.toContain(
        createAuthoringFuzzPlan(seed, steps).at(-1)?.kind,
      );
    }
  }
});

it.each([
  ["darwin", "Meta+ArrowLeft", "Meta+ArrowRight"],
  ["linux", "Home", "End"],
  ["win32", "Home", "End"],
])("uses platform line navigation keys on %s", (platform, start, end) => {
  expect(lineNavigationKeys(platform)).toEqual({ start, end });
});

it("uses the caller's line navigation keys for fuzz operations", () => {
  const macKeys = lineNavigationKeys("darwin");
  expect(authoringFuzzLineNavigationKeys("linux", macKeys)).toEqual(macKeys);
  expect(authoringFuzzLineNavigationKeys("linux")).toEqual(
    lineNavigationKeys("linux"),
  );
});

it("maps absolute seeds to stable synthetic and committed layout profiles", () => {
  expect([0, 1, 3, 5, 7, 9, 11, 13].map(authoringFuzzProfileIndex)).toEqual(
    Array(8).fill(null),
  );
  expect([2, 4, 6, 8, 10, 12, 14].map(authoringFuzzProfileIndex)).toEqual([
    0, 1, 2, 3, 4, 5, 0,
  ]);
  expect(() => authoringFuzzProfileIndex(-1)).toThrow(
    "non-negative safe integer",
  );
});

it("requires the scaled profile to render below 0.99 after viewport setup", async () => {
  await expect(
    assertSlideIsScaled(pageAtScale(0.98), "#scaled-slide"),
  ).resolves.toBeUndefined();
  await expect(
    assertSlideIsScaled(pageAtScale(0.99), "#scaled-slide"),
  ).rejects.toThrow("scaled fixture did not scale below 0.99");
  await expect(
    assertSlideIsScaled(pageAtScale(1), "#scaled-slide"),
  ).rejects.toThrow("scale 1.000");
  await expect(
    assertSlideIsScaled(pageAtScale(0), "#scaled-slide"),
  ).rejects.toThrow("scale 0.000");
});

it("checks the rendered slide scale when the scaled profile is requested", async () => {
  const page = {
    on: () => {},
    off: () => {},
    locator: (selector: string) =>
      selector === "#editor"
        ? { waitFor: async () => {} }
        : {
            evaluate: async (readScale: (element: HTMLElement) => number) =>
              readScale({
                offsetWidth: 100,
                getBoundingClientRect: () => ({ width: 100 }),
              } as HTMLElement),
          },
  };

  await expect(
    runAuthoringFuzz(page, {
      seed: 42,
      steps: 1,
      editorSelector: "#editor",
      slideSelector: "#slide",
      slideContentSelector: "#slide-content",
      originalHtml: "",
      originalSlideHtml: "",
      finishAndReload: async () => ({
        originalHtml: "",
        liveHtml: "",
        savedHtml: "",
        reloadedHtml: "",
      }),
      modifier: "Meta",
      expectScaledSlide: true,
    }),
  ).rejects.toThrow("scaled fixture did not scale below 0.99 (scale 1.000)");
});

it("prints a bounded failure excerpt with a deterministic seed and replay step count", () => {
  const plan = createAuthoringFuzzPlan(42, 500);
  const failure = formatAuthoringFuzzFailure(
    42,
    "step 499",
    plan,
    "caret left the editor",
    "firefox",
  );
  const logHeader = failure.message.indexOf("Failure log:");
  const jsonStart = failure.message.indexOf("\n", logHeader) + 1;
  const excerpt = JSON.parse(failure.message.slice(jsonStart)) as Array<{
    step: number;
    operation: unknown;
  }>;

  expect(failure.message).toContain("--authoring-fuzz --seed 42 --steps 500");
  expect(failure.message).toContain("--browser firefox");
  expect(failure.message).toContain(
    "Failure log: steps 480-499 of 500 replay steps",
  );
  expect(excerpt).toHaveLength(20);
  expect(excerpt[0]?.step).toBe(480);
  expect(excerpt.at(-1)?.step).toBe(499);
  expect(excerpt.at(-1)?.operation).toEqual(plan.at(-1));
});
