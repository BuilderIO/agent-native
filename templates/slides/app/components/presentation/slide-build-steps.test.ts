// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { Slide, SlideAnimation } from "@/context/DeckContext";
import {
  byParagraphTargets,
  resolveSlideAnimationElement,
} from "@/lib/slide-animation-elements";

import {
  annotateBuildSteps,
  findBuildStepElements,
  getBuildSteps,
  revealAnimationValue,
  setBuildState,
} from "./slide-build-steps";

function slideWith(content: string, animations?: SlideAnimation[]): Slide {
  return { id: "s", layout: "content", notes: "", content, animations };
}

const textBox = `<div class="fmd-slide"><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

function mount(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("getBuildSteps", () => {
  it("counts the paragraph steps the editor lists, from the same function", () => {
    const slide = slideWith(textBox, [
      {
        id: "p",
        elementIndex: 0,
        elementPath: [0],
        byParagraph: true,
        type: "fade",
      },
    ]);
    const root = new DOMParser()
      .parseFromString(textBox, "text/html")
      .querySelector(".fmd-slide")!;
    const editorList = byParagraphTargets(root.children[0]!);

    expect(getBuildSteps(slide).steps).toHaveLength(editorList.length);
    expect(getBuildSteps(slide).steps).toHaveLength(3);
  });

  it("keeps an unresolved reveal out of the steps and reports it", () => {
    const slide = slideWith(textBox, [
      { id: "ok", elementIndex: 0, elementPath: [0, 1], type: "fade" },
      { id: "stale", elementIndex: 0, elementPath: [4], type: "fade" },
    ]);
    const build = getBuildSteps(slide);

    expect(build.steps.map((step) => step.elementPath)).toEqual([[0, 1]]);
    expect(build.unresolved).toEqual([
      { animationIndex: 1, id: "stale", reason: "stale-path" },
    ]);
  });

  it("leaves an unresolved object visible and hides only the resolved reveal", () => {
    const slide = slideWith(textBox, [
      { id: "ok", elementIndex: 0, elementPath: [0, 1], type: "fade" },
      { id: "stale", elementIndex: 0, elementPath: [4], type: "fade" },
    ]);
    const annotated = annotateBuildSteps(slide, getBuildSteps(slide).steps, 0);
    const root = mount(annotated.content);
    const [two] = findBuildStepElements(root, 1);
    const three = resolveSlideAnimationElement(
      root.querySelector(".fmd-slide")!,
      { elementIndex: 0, elementPath: [0, 2] },
    );

    expect(two?.getAttribute("data-pstep-state")).toBe("hidden");
    expect(three?.hasAttribute("data-pstep")).toBe(false);
    root.remove();
  });

  it("lets a plain reveal and a by-paragraph reveal on the same box both resolve when they do not overlap", () => {
    const slide = slideWith(
      `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p></div></div>`,
      [
        { id: "title", elementIndex: 0, elementPath: [0], type: "zoom" },
        {
          id: "body",
          elementIndex: 0,
          elementPath: [1],
          byParagraph: true,
          type: "fade",
        },
      ],
    );
    const build = getBuildSteps(slide);

    expect(build.unresolved).toEqual([]);
    expect(build.steps.map((step) => step.elementPath)).toEqual([
      [0],
      [1, 0],
      [1, 1],
    ]);
  });
});

describe("setBuildState", () => {
  const steps: SlideAnimation[] = [
    { id: "a", elementIndex: 0, elementPath: [0, 0], type: "fade" },
    { id: "b", elementIndex: 1, elementPath: [0, 1], type: "slide-up" },
  ];

  function animationOf(elements: Array<Element | null>, index: number): string {
    return (elements[index] as HTMLElement).style.animation;
  }

  function stepElements(state: number, previous: number | null) {
    const root = mount(
      annotateBuildSteps(slideWith(textBox, steps), steps, 0).content,
    );
    const elements = findBuildStepElements(root, steps.length);
    setBuildState(elements, steps, state, previous);
    return { root, elements };
  }

  it("animates only the step that entered on a press", () => {
    const { root, elements } = stepElements(1, 0);
    expect(elements[0]?.getAttribute("data-pstep-state")).toBe("entering");
    expect(animationOf(elements, 0)).toContain("elem-appear");
    expect(elements[1]?.getAttribute("data-pstep-state")).toBe("hidden");
    root.remove();
  });

  it("does not replay a built step on the next press", () => {
    const { root, elements } = stepElements(2, 1);
    // Element 0 was built on an earlier press and stays shown without a reveal.
    expect(elements[0]?.getAttribute("data-pstep-state")).toBe("shown");
    expect(animationOf(elements, 0)).toBe("");
    expect(elements[1]?.getAttribute("data-pstep-state")).toBe("entering");
    root.remove();
  });

  it("shows a backward entry fully built with no reveal", () => {
    const { root, elements } = stepElements(2, null);
    for (const element of elements) {
      expect(element?.getAttribute("data-pstep-state")).toBe("shown");
      expect((element as HTMLElement).style.animation).toBe("");
    }
    root.remove();
  });

  it("hides a step again when stepping back, with no reveal", () => {
    const { root, elements } = stepElements(2, 1);
    setBuildState(elements, steps, 1, 2);
    expect(elements[1]?.getAttribute("data-pstep-state")).toBe("hidden");
    expect(animationOf(elements, 1)).toBe("");
    root.remove();
  });
});

describe("reveal timing", () => {
  it("fades an object in linearly over one second, with no movement", () => {
    expect(revealAnimationValue("fade", false)).toBe(
      "elem-appear 1000ms linear both",
    );
  });

  it("shows an appear at once, with no animation", () => {
    expect(revealAnimationValue("appear", false)).toBe("");
  });
});

describe("setBuildState snap", () => {
  const steps: SlideAnimation[] = [
    { id: "a", elementIndex: 0, elementPath: [0, 0], type: "fade" },
    { id: "b", elementIndex: 1, elementPath: [0, 1], type: "fade" },
    { id: "c", elementIndex: 2, elementPath: [0, 2], type: "fade" },
  ];
  const fadeValue = revealAnimationValue("fade", false);

  it("snaps a reveal still running to its final state, and starts the next at once", () => {
    const root = mount(
      annotateBuildSteps(slideWith(textBox, steps), steps, 0).content,
    );
    const elements = findBuildStepElements(root, steps.length);
    setBuildState(elements, steps, 1, 0);
    expect((elements[0] as HTMLElement).style.animation).toBe(fadeValue);

    // Second press lands while step 0 is still running.
    setBuildState(elements, steps, 2, 1);

    expect(elements[0]?.getAttribute("data-pstep-state")).toBe("shown");
    expect((elements[0] as HTMLElement).style.animation).toBe("");
    expect(elements[1]?.getAttribute("data-pstep-state")).toBe("entering");
    expect((elements[1] as HTMLElement).style.animation).toBe(fadeValue);
    root.remove();
  });

  it("does not queue: a press during a reveal moves straight to the next step", () => {
    const root = mount(
      annotateBuildSteps(slideWith(textBox, steps), steps, 0).content,
    );
    const elements = findBuildStepElements(root, steps.length);
    setBuildState(elements, steps, 1, 0);
    setBuildState(elements, steps, 2, 1);
    setBuildState(elements, steps, 3, 2);

    expect(elements.map((el) => el?.getAttribute("data-pstep-state"))).toEqual([
      "shown",
      "shown",
      "entering",
    ]);
    expect((elements[2] as HTMLElement).style.animation).toBe(fadeValue);
    root.remove();
  });
});

describe("reduced motion reveals", () => {
  it("maps every reveal to a motion under normal motion and to none under reduced motion", () => {
    for (const type of ["fade", "slide-up", "zoom"] as const) {
      expect(revealAnimationValue(type, false)).toContain("elem-");
    }
    for (const type of ["appear", "fade", "slide-up", "zoom"] as const) {
      expect(revealAnimationValue(type, true)).toBe("");
    }
  });

  it("changes the same steps in the same order with or without motion, and only motion differs", () => {
    const steps: SlideAnimation[] = [
      { id: "a", elementIndex: 0, elementPath: [0, 0], type: "slide-up" },
      { id: "b", elementIndex: 1, elementPath: [0, 1], type: "zoom" },
      { id: "c", elementIndex: 2, elementPath: [0, 2], type: "fade" },
    ];
    const run = (reducedMotion: boolean) => {
      const root = mount(
        annotateBuildSteps(slideWith(textBox, steps), steps, 0).content,
      );
      const elements = findBuildStepElements(root, steps.length);
      const seen: Array<{ state: string | null; animation: string }> = [];
      for (const [buildStep, previous] of [
        [1, 0],
        [2, 1],
        [3, 2],
      ] as const) {
        setBuildState(elements, steps, buildStep, previous, reducedMotion);
        seen.push(
          ...elements.map((element) => ({
            state: element?.getAttribute("data-pstep-state") ?? null,
            animation: (element as HTMLElement).style.animation,
          })),
        );
      }
      root.remove();
      return seen;
    };

    const normal = run(false);
    const reduced = run(true);
    expect(reduced.map((entry) => entry.state)).toEqual(
      normal.map((entry) => entry.state),
    );
    expect(reduced.every((entry) => entry.animation === "")).toBe(true);
    expect(normal.some((entry) => entry.animation !== "")).toBe(true);
  });
});
