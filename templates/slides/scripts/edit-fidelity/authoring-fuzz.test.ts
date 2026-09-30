import { expect, it } from "vitest";

import {
  assertAuthoringPersistence,
  assertByteIdenticalHtml,
  assertSlideIsScaled,
  createAuthoringFuzzPlan,
  formatAuthoringFuzzFailure,
  runAuthoringFuzz,
} from "./authoring-fuzz.ts";

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
  ).toThrow("saved HTML differed from the post-edit live slide");
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
  ).toThrow("reloaded slide HTML differed from the saved HTML");
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
  );
  const logHeader = failure.message.indexOf("Failure log:");
  const jsonStart = failure.message.indexOf("\n", logHeader) + 1;
  const excerpt = JSON.parse(failure.message.slice(jsonStart)) as Array<{
    step: number;
    operation: unknown;
  }>;

  expect(failure.message).toContain("--authoring-fuzz --seed 42 --steps 500");
  expect(failure.message).toContain(
    "Failure log: steps 480-499 of 500 replay steps",
  );
  expect(excerpt).toHaveLength(20);
  expect(excerpt[0]?.step).toBe(480);
  expect(excerpt.at(-1)?.step).toBe(499);
  expect(excerpt.at(-1)?.operation).toEqual(plan.at(-1));
});
