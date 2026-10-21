// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";
import {
  byParagraphTargets,
  expandByParagraphAnimations,
  getElementAnimationValue,
  getElementPath,
  getPersistedElementPath,
  getSlideAnimationTargetKey,
  getSlideAnimationTargetPreview,
  parseSlideAnimationElements,
  resolveRevealSteps,
  resolveSlideAnimationElement,
  resolveSlideAnimationTargets,
  revealStepsOf,
  storedOrdinalAtPath,
  storedPathOfRenderedElement,
} from "@/lib/slide-animation-elements";
import { stampSlideSource } from "@/lib/slide-source-map";

const contentSlide = `<div class="fmd-slide" style="padding: 80px 110px; justify-content: center;">
  <div style="font-size: 16px;">SECTION</div>
  <div style="font-size: 40px;">Slide Title</div>
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>First point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>Second point</span></div>
    <div style="display: flex; align-items: baseline; gap: 20px;"><span>•</span><span>Third point</span></div>
  </div>
</div>`;

const titleSlide = `<div class="fmd-slide" style="padding: 80px 110px; justify-content: space-between;">
  <div>
    <div>Deck</div>
  </div>
  <div>
    <div>Presentation Title</div>
  </div>
  <div>
    <div>Your Name</div>
    <div>Date</div>
  </div>
</div>`;

describe("slide animation element parsing", () => {
  it("exposes top-level copy and nested bullets as animatable elements", () => {
    const elements = parseSlideAnimationElements(contentSlide);

    expect(elements.map((element) => element.preview)).toEqual([
      "SECTION",
      "Slide Title",
      "•First point",
      "•Second point",
      "•Third point",
    ]);
  });

  it("does not collapse nested title-slide groups to only the final wrapper", () => {
    const elements = parseSlideAnimationElements(titleSlide);

    expect(elements.map((element) => element.preview)).toEqual([
      "Deck",
      "Presentation Title",
      "Your Name",
      "Date",
    ]);
  });

  it("resolves old elementIndex animations through the legacy container", () => {
    expect(
      getSlideAnimationTargetPreview(contentSlide, {
        elementIndex: 0,
      }),
    ).toBe("•First point");
    expect(
      getSlideAnimationTargetKey(contentSlide, {
        elementIndex: 0,
      }),
    ).toBe("2.0");
  });

  it("resolves new elementPath animations to any nested element", () => {
    expect(
      getSlideAnimationTargetPreview(titleSlide, {
        elementIndex: 1,
        elementPath: [1, 0],
      }),
    ).toBe("Presentation Title");
    expect(
      getSlideAnimationTargetKey(titleSlide, {
        elementIndex: 1,
        elementPath: [1, 0],
      }),
    ).toBe("1.0");
  });

  it("does not fall back to a different element when a preferred path is stale", () => {
    const doc = new DOMParser().parseFromString(contentSlide, "text/html");
    const root = doc.querySelector(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    expect(
      resolveSlideAnimationElement(root, {
        elementIndex: 0,
        elementPath: [99],
      }),
    ).toBeNull();
    const outcomes = resolveRevealSteps(root, [
      { id: "kept", elementIndex: 0, elementPath: [2, 0] },
      { id: "stale", elementIndex: 1, elementPath: [99] },
    ]);
    expect(outcomes[0]).toMatchObject({ ok: true, path: [2, 0] });
    expect(outcomes[1]).toMatchObject({
      ok: false,
      id: "stale",
      reason: "stale-path",
    });
  });

  it("flattens the editor-only AutoFit wrapper before persisting a path", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide">
        <style>.fmd-slide { color: red; }</style>
        <div data-fmd-autofit-content>
          <div class="fmd-layout-spacer"></div>
          <div><span data-target>Target</span></div>
          <div>Sibling</div>
        </div>
        <div>After</div>
      </div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    const target = doc.querySelector<HTMLElement>("[data-target]");
    expect(root).not.toBeNull();
    expect(target).not.toBeNull();
    if (!root || !target) return;

    expect(getElementPath(root, target)).toEqual([1, 1, 0]);
    expect(getPersistedElementPath(root, target)).toEqual([1, 0]);
    expect(
      resolveSlideAnimationElement(root, {
        elementIndex: 0,
        elementPath: [1, 0],
      }),
    ).toBe(target);
  });

  it("keeps parsed paths aligned after preserved layout spacers", () => {
    const html = `<div class="fmd-slide">
      <div>First</div>
      <div class="fmd-layout-spacer" data-slide-layout-preserved="true"></div>
      <div>Second</div>
    </div>`;

    expect(parseSlideAnimationElements(html).map(({ path }) => path)).toEqual([
      [0],
      [1],
    ]);
  });

  it("keeps animation identities aligned after preserved layout spacers", () => {
    const html = `<div class="fmd-slide">
      <div>First</div>
      <div class="fmd-layout-spacer" data-slide-layout-preserved="true"></div>
      <div>Second</div>
    </div>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const targets = [
      { elementIndex: 0, elementPath: [0] },
      { elementIndex: 1, elementPath: [1] },
    ];
    expect(
      revealStepsOf(resolveRevealSteps(root, targets)).map((step) =>
        step.path.join("."),
      ),
    ).toEqual(["0", "1"]);
    expect(getSlideAnimationTargetKey(html, targets[1]!)).toBe("1");
  });

  it("reveals every imported paragraph of a text object through the resolver", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide">
        <div class="fmd-pptx-text">
          <p data-pptx-paragraph="0">First</p>
          <p data-pptx-paragraph="1">Second</p>
        </div>
      </div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const outcomes = resolveRevealSteps(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(revealStepsOf(outcomes).map((step) => step.path)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("expands paragraph animations from an individually selected paragraph", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide">
        <div class="fmd-pptx-text">
          <p data-pptx-paragraph="0">First</p>
          <p data-pptx-paragraph="1">Second</p>
        </div>
      </div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(
      expanded?.map(({ id, elementPath, byParagraph, type }) => ({
        id,
        elementPath,
        byParagraph,
        type,
      })),
    ).toEqual([
      {
        id: "animation-1-paragraph-0",
        elementPath: [0, 0],
        byParagraph: false,
        type: "slide-up",
      },
      {
        id: "animation-1-paragraph-1",
        elementPath: [0, 1],
        byParagraph: false,
        type: "slide-up",
      },
    ]);
  });

  it.each([
    {
      description: "native paragraphs",
      html: `<div class="fmd-slide">
        <div><p>First</p><p>Second</p></div>
      </div>`,
      expectedPaths: [
        [0, 0],
        [0, 1],
      ],
    },
    {
      description: "bullet list items",
      html: `<div class="fmd-slide">
        <div><ul><li>First</li><li>Second</li></ul></div>
      </div>`,
      expectedPaths: [
        [0, 0, 0],
        [0, 0, 1],
      ],
    },
  ])("expands by paragraph for $description", ({ html, expectedPaths }) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(
      expanded?.map(({ id, elementPath, byParagraph, type }) => ({
        id,
        elementPath,
        byParagraph,
        type,
      })),
    ).toEqual(
      expectedPaths.map((elementPath, paragraphIndex) => ({
        id: `animation-1-paragraph-${paragraphIndex}`,
        elementPath,
        byParagraph: false,
        type: "slide-up",
      })),
    );
  });

  it("includes nested list items when a surrounding paragraph is selected", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide">
        <div>
          <p>Introduction</p>
          <ul><li>First point</li><li>Second point</li></ul>
          <p>Closing point</p>
        </div>
      </div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 2],
    ]);
  });

  it("reveals nested list items in their own steps", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><ul>
        <li>First<ul><li>Nested point</li></ul></li>
        <li>Second</li>
      </ul></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 1],
    ]);
  });

  it("reveals paragraphs within one list item in separate steps", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><ul>
        <li><p>First paragraph</p><p>Second paragraph</p>
          <ul><li>Nested point</li></ul>
        </li>
        <li>Following item</li>
      </ul></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0, 0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 0, 2, 0],
      [0, 0, 1],
    ]);
  });

  it("reveals list-item paragraphs and nested lists in source order", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><ul>
        <li><p>First paragraph</p>
          <ul><li>Nested point</li></ul>
          <p>Second paragraph</p>
        </li>
        <li>Following item</li>
      </ul></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 1, 0],
      [0, 0, 0, 2],
      [0, 0, 1],
    ]);
  });

  it("reveals inline children and nested lists in source order", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><ul>
        <li><p>First paragraph</p>
          <ul><li>Nested point</li></ul>
          <strong>Inline label</strong>
          <p>Second paragraph</p>
        </li>
        <li>Following item</li>
      </ul></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 1, 0],
      [0, 0, 0, 2],
      [0, 0, 0, 3],
      [0, 0, 1],
    ]);
  });

  it("finds nested lists under wrappers between list-item paragraphs", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><ul>
        <li><p>First paragraph</p>
          <div><ul><li>Nested point</li></ul></div>
          <p>Second paragraph</p>
        </li>
        <li>Following item</li>
      </ul></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 2],
      [0, 0, 1],
    ]);
  });

  it.each([
    {
      description: "bare text",
      mixedContent: "Intro",
      nestedListIndex: 1,
    },
  ])(
    "expands list items with $description and wrapped paragraphs separately",
    ({ mixedContent, nestedListIndex }) => {
      const doc = new DOMParser().parseFromString(
        `<div class="fmd-slide"><div><ul>
          <li>${mixedContent}<div>Section intro<p>First paragraph</p><p>Second paragraph</p></div>
            <ul><li>Nested point</li></ul>
          </li>
          <li>Following item</li>
        </ul></div></div>`,
        "text/html",
      );
      const root = doc.querySelector<HTMLElement>(".fmd-slide");
      expect(root).not.toBeNull();
      if (!root) return;

      const expanded = expandByParagraphAnimations(root, [
        {
          id: "animation-1",
          elementIndex: 0,
          elementPath: [0, 0, 0],
          byParagraph: true,
          type: "slide-up",
        },
      ]);

      expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
        [0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 1],
        [0, 0, 0, nestedListIndex, 0],
        [0, 0, 1],
      ]);
    },
  );

  it.each([{ elementPath: [0, 0, 0, 0] }, { elementPath: [0, 0, 1, 0] }])(
    "expands a selected paragraph inside its containing list",
    ({ elementPath }) => {
      const doc = new DOMParser().parseFromString(
        `<div class="fmd-slide"><div><ul>
          <li><p>First</p></li>
          <li><p>Second</p></li>
        </ul></div></div>`,
        "text/html",
      );
      const root = doc.querySelector<HTMLElement>(".fmd-slide");
      expect(root).not.toBeNull();
      if (!root) return;

      const expanded = expandByParagraphAnimations(root, [
        {
          id: "animation-1",
          elementIndex: 0,
          elementPath,
          byParagraph: true,
          type: "slide-up",
        },
      ]);

      expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
        [0, 0, 0, 0],
        [0, 0, 1, 0],
      ]);
    },
  );

  it("expands paragraphs wrapped inside a list item independently", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><ul>
        <li><div><p>First</p><p>Second</p></div></li>
      </ul></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1],
    ]);
  });

  it("does not expand into unrelated nested text blocks", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div>
        <p>First</p>
        <div><p>Separate block one</p><p>Separate block two</p></div>
        <p>Second</p>
      </div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0],
      [0, 2],
    ]);
  });

  it("preserves an explicit animation over a by-paragraph expansion", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><p>First</p><p>Second</p></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "all-paragraphs",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
      {
        id: "second-paragraph",
        elementIndex: 1,
        elementPath: [0, 1],
        byParagraph: false,
        type: "fade",
      },
    ]);

    expect(
      expanded?.map(({ id, elementPath, byParagraph, type }) => ({
        id,
        elementPath,
        byParagraph,
        type,
      })),
    ).toEqual([
      {
        id: "all-paragraphs-paragraph-0",
        elementPath: [0, 0],
        byParagraph: false,
        type: "slide-up",
      },
      {
        id: "second-paragraph",
        elementPath: [0, 1],
        byParagraph: false,
        type: "fade",
      },
    ]);
    expect(expanded && resolveSlideAnimationTargets(root, expanded)).not.toBe(
      null,
    );

    const reversed = expandByParagraphAnimations(root, [
      {
        id: "second-paragraph",
        elementIndex: 1,
        elementPath: [0, 1],
        byParagraph: false,
        type: "fade",
      },
      {
        id: "all-paragraphs",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);
    expect(
      reversed?.map(({ elementPath, type }) => ({ elementPath, type })),
    ).toEqual([
      { elementPath: [0, 0], type: "slide-up" },
      { elementPath: [0, 1], type: "fade" },
    ]);
  });

  it("uses the first configured effect for overlapping by-paragraph steps", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><p>First</p><p>Second</p></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "first-effect",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "fade",
      },
      {
        id: "second-effect",
        elementIndex: 1,
        elementPath: [0, 1],
        byParagraph: true,
        type: "zoom",
      },
    ]);

    expect(
      expanded?.map(({ id, elementPath, type }) => ({
        id,
        elementPath,
        type,
      })),
    ).toEqual([
      {
        id: "first-effect-paragraph-0",
        elementPath: [0, 0],
        type: "fade",
      },
      {
        id: "first-effect-paragraph-1",
        elementPath: [0, 1],
        type: "fade",
      },
    ]);
  });

  it("expands by paragraph when one native paragraph is selected", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="fmd-slide"><div><p>First</p><p>Second</p></div></div>`,
      "text/html",
    );
    const root = doc.querySelector<HTMLElement>(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const expanded = expandByParagraphAnimations(root, [
      {
        id: "animation-1",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "slide-up",
      },
    ]);

    expect(expanded?.map(({ elementPath }) => elementPath)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("shares the configured effect timing between playback surfaces", () => {
    expect(getElementAnimationValue("appear")).toContain("elem-appear");
    expect(getElementAnimationValue("slide-up")).toContain("elem-slide-up");
    expect(getElementAnimationValue("zoom")).toContain("elem-zoom");
  });

  it("resolves every ordered target exactly once", () => {
    const doc = new DOMParser().parseFromString(contentSlide, "text/html");
    const root = doc.querySelector(".fmd-slide");
    expect(root).not.toBeNull();
    if (!root) return;

    const elements = parseSlideAnimationElements(contentSlide);
    const targets = elements.map((element) => ({
      elementIndex: element.index,
      elementPath: element.path,
    }));
    const outcomes = resolveRevealSteps(root, targets);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(revealStepsOf(outcomes).map((step) => step.path.join("."))).toEqual(
      elements.map((element) => element.path.join(".")),
    );
    expect(
      resolveRevealSteps(root, [targets[0]!, targets[0]!])[1],
    ).toMatchObject({ ok: false, reason: "duplicate-after-expansion" });
  });

  it("includes empty styled shapes without exposing styled layout wrappers", () => {
    const elements = parseSlideAnimationElements(`<div class="fmd-slide">
      <div style="display: flex; gap: 20px; width: 100%;">
        <div style="width: 60px; height: 4px; background: #00E5FF;"></div>
        <p>Quote text</p>
      </div>
    </div>`);

    expect(elements.map((element) => element.preview)).toEqual([
      "Element 1",
      "Quote text",
    ]);
    expect(elements.map((element) => element.path)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });
});

function slideRoot(html: string): Element {
  const root = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(".fmd-slide");
  if (!root) throw new Error("fixture has no .fmd-slide");
  return root;
}

describe("reveal resolver", () => {
  const boxSlide = `<div class="fmd-slide">
    <div class="text-box"><p>One</p><p>Two</p><p>Three</p></div>
  </div>`;

  it("resolves a plain reveal to one step on its element", () => {
    const [outcome] = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "a", elementIndex: 0, elementPath: [0, 1], type: "fade" },
    ]);
    expect(outcome).toMatchObject({ ok: true, id: "a", path: [0, 1] });
    expect(revealStepsOf([outcome!]).map((step) => step.path)).toEqual([
      [0, 1],
    ]);
  });

  it("reports a path that no longer resolves as stale-path", () => {
    const [outcome] = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "gone", elementIndex: 0, elementPath: [9, 9], type: "fade" },
    ]);
    expect(outcome).toMatchObject({
      ok: false,
      id: "gone",
      reason: "stale-path",
    });
  });

  it("reports an elementIndex with no legacy container child as missing-element", () => {
    const [outcome] = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "legacy", elementIndex: 7, type: "fade" },
    ]);
    expect(outcome).toMatchObject({ ok: false, reason: "missing-element" });
  });

  it("reports every reveal as missing-element when the content has no slide root", () => {
    const outcomes = resolveRevealSteps(null, [
      { id: "a", elementIndex: 0, elementPath: [0], type: "fade" },
    ]);
    expect(outcomes).toMatchObject([{ ok: false, reason: "missing-element" }]);
  });

  it("keeps resolving the other reveals when one is stale", () => {
    const outcomes = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "stale", elementIndex: 0, elementPath: [5], type: "fade" },
      { id: "ok", elementIndex: 0, elementPath: [0, 0], type: "zoom" },
    ]);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, true]);
  });

  it("plays an explicit reveal at its paragraph's step in a by-paragraph reveal", () => {
    const outcomes = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "explicit", elementIndex: 1, elementPath: [0, 1], type: "fade" },
      {
        id: "paragraphs",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "fade",
      },
    ]);
    expect(outcomes[0]).toMatchObject({ ok: true, steps: [] });
    expect(
      revealStepsOf(outcomes).map((step) => [step.animation.id, step.path]),
    ).toEqual([
      ["paragraphs", [0, 0]],
      ["explicit", [0, 1]],
      ["paragraphs", [0, 2]],
    ]);
  });

  it("rejects a by-paragraph reveal on a box when the box is also revealed", () => {
    const outcomes = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "box", elementIndex: 0, elementPath: [0], type: "fade" },
      {
        id: "paragraphs",
        elementIndex: 0,
        elementPath: [0],
        byParagraph: true,
        type: "fade",
      },
    ]);
    expect(outcomes[1]).toMatchObject({
      ok: false,
      reason: "duplicate-after-expansion",
    });
  });

  it("keeps plain nested reveals, which are not expansions", () => {
    const outcomes = resolveRevealSteps(slideRoot(boxSlide), [
      { id: "box", elementIndex: 0, elementPath: [0], type: "fade" },
      { id: "child", elementIndex: 0, elementPath: [0, 0], type: "zoom" },
    ]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  it("steps a container's paragraphs in document order", () => {
    const steps = byParagraphTargets(slideRoot(boxSlide).children[0]!);
    expect(steps.map((step) => step.textContent)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("starts the reveal at a selected paragraph and runs to the end", () => {
    const [outcome] = resolveRevealSteps(slideRoot(boxSlide), [
      {
        id: "from-two",
        elementIndex: 1,
        elementPath: [0, 1],
        byParagraph: true,
        type: "fade",
      },
    ]);
    expect(revealStepsOf([outcome!]).map((step) => step.path)).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it("treats an element with only inline children as one step", () => {
    const root = slideRoot(
      `<div class="fmd-slide"><p><span>a</span><span>b</span></p></div>`,
    );
    const [outcome] = resolveRevealSteps(root, [
      {
        id: "inline",
        elementIndex: 0,
        elementPath: [0],
        byParagraph: true,
        type: "fade",
      },
    ]);
    expect(revealStepsOf([outcome!]).map((step) => step.path)).toEqual([[0]]);
  });

  it("expands a div-with-paragraphs as the editor shows it", () => {
    const root = slideRoot(
      `<div class="fmd-slide"><div><div><p>One</p><p>Two</p></div></div></div>`,
    );
    const [outcome] = resolveRevealSteps(root, [
      {
        id: "text",
        elementIndex: 0,
        elementPath: [0, 0],
        byParagraph: true,
        type: "fade",
      },
    ]);
    expect(revealStepsOf([outcome!]).map((step) => step.path)).toEqual([
      [0, 0, 0],
      [0, 0, 1],
    ]);
  });
});

describe("stored-path derivation", () => {
  it("derives the stored path of a rendered element after the sanitizer drops an svg before it", () => {
    const stored = `<div class="fmd-slide"><svg viewBox="0 0 4 4"><circle r="1"/></svg><p>Headline</p><p>Body</p></div>`;
    const rendered = sanitizeSlideHtml(
      stampSlideSource(stored, "slide-1").html,
      {},
    );
    const renderedRoot = slideRoot(rendered);
    const headline = Array.from(renderedRoot.querySelectorAll("p"))[0]!;

    // The rendered DOM has no svg, so its own index for Headline is 0.
    expect(getPersistedElementPath(renderedRoot, headline)).toEqual([0]);
    // The stored HTML, which the runtime resolves against, has the svg at 0.
    expect(storedPathOfRenderedElement(stored, headline)).toEqual([1]);
    expect(storedOrdinalAtPath(stored, [1])).toBe(3);
    expect(
      resolveSlideAnimationElement(slideRoot(stored), {
        elementIndex: 1,
        elementPath: [1],
      })?.textContent,
    ).toBe("Headline");
  });
});
