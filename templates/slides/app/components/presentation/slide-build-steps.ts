import type {
  AnimationType,
  Slide,
  SlideAnimation,
} from "@/context/DeckContext";
import {
  findLegacyAnimationContainer,
  getElementAnimationValue,
  getPersistedElementPath,
  resolveRevealSteps,
  resolveSlideAnimationElement,
  type RevealUnresolvedReason,
} from "@/lib/slide-animation-elements";

import { prefersReducedMotion } from "./slide-transition-motion";

export interface UnresolvedReveal {
  animationIndex: number;
  id: string | null;
  reason: RevealUnresolvedReason;
}

export interface BuildSteps {
  /** Resolved reveals, flattened, in playback order. */
  steps: SlideAnimation[];
  /** Reveals that did not resolve. Their objects stay visible and are never hidden. */
  unresolved: UnresolvedReveal[];
}

/** Whether the slide has builds to hold back. Plain data, so it is safe on the server. */
export function hasBuildSteps(slide: Slide): boolean {
  return (slide.animations?.length ?? 0) > 0 || Boolean(slide.splitByParagraph);
}

// DOMParser exists only in the browser. Nothing that reaches this may run during
// a server render; the presentation view defers it until after hydration.
function storedSlideRoot(content: string): Element | null {
  return new DOMParser()
    .parseFromString(content, "text/html")
    .querySelector(".fmd-slide");
}

function legacyParagraphSteps(content: string): SlideAnimation[] {
  const root = storedSlideRoot(content);
  if (!root) return [];

  const paragraphs = Array.from(
    root.querySelectorAll(".fmd-pptx-text p[data-pptx-paragraph]"),
  ).filter((paragraph) => {
    const textBox = paragraph.closest(".fmd-pptx-text");
    return (
      (textBox?.querySelectorAll("p[data-pptx-paragraph]").length ?? 0) > 1
    );
  });
  if (paragraphs.length > 1) {
    return paragraphs.flatMap((paragraph, index) => {
      const elementPath = getPersistedElementPath(root, paragraph);
      return elementPath
        ? [
            {
              id: `auto-paragraph-${index}`,
              elementIndex: index,
              elementPath,
              type: "slide-up" as AnimationType,
            },
          ]
        : [];
    });
  }

  const container = findLegacyAnimationContainer(root);
  if (!container) return [];
  return Array.from(container.children).map((_, i) => ({
    id: `auto-${i}`,
    elementIndex: i,
    type: "slide-up" as AnimationType,
  }));
}

export function getBuildSteps(slide: Slide): BuildSteps {
  if (slide.animations && slide.animations.length > 0) {
    const outcomes = resolveRevealSteps(
      storedSlideRoot(slide.content),
      slide.animations,
    );
    const steps: SlideAnimation[] = [];
    const unresolved: UnresolvedReveal[] = [];
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        unresolved.push({
          animationIndex: outcome.animationIndex,
          id: outcome.id,
          reason: outcome.reason,
        });
        continue;
      }
      for (const [n, step] of outcome.steps.entries()) {
        steps.push({
          id:
            outcome.steps.length > 1
              ? `${step.animation.id}-${n + 1}`
              : step.animation.id,
          elementIndex: step.path[step.path.length - 1] ?? 0,
          elementPath: step.path,
          type: step.animation.type,
        });
      }
    }
    return { steps, unresolved };
  }
  if (slide.splitByParagraph) {
    return { steps: legacyParagraphSteps(slide.content), unresolved: [] };
  }
  return { steps: [], unresolved: [] };
}

/**
 * The slide HTML with each step element marked `data-pstep` and its state at
 * `buildStep`. Only this initial state is baked in. Later presses move state on
 * the mounted DOM with setBuildState, so the HTML string stays the same and
 * the slide is not re-rendered.
 */
export function annotateBuildSteps(
  slide: Slide,
  steps: readonly SlideAnimation[] | null | undefined,
  buildStep: number,
): Slide {
  if (!steps || steps.length === 0) return slide;
  const doc = new DOMParser().parseFromString(slide.content, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return slide;

  steps.forEach((step, index) => {
    const element = resolveSlideAnimationElement(root, step);
    if (!element) return;
    element.setAttribute("data-pstep", String(index));
    element.setAttribute(
      "data-pstep-state",
      index < buildStep ? "shown" : "hidden",
    );
  });
  return { ...slide, content: doc.head.innerHTML + doc.body.innerHTML };
}

/** The `data-pstep` element for each step index, or null where it is missing. */
export function findBuildStepElements(
  root: ParentNode,
  count: number,
): Array<Element | null> {
  return Array.from({ length: count }, (_, index) =>
    root.querySelector(`[data-pstep="${index}"]`),
  );
}

// Fade in is opacity only, linear, one second. Google Slides has no object
// duration control yet, so this is the only length.
const FADE_REVEAL = "elem-appear 1000ms linear both";

/**
 * The animation an entering reveal plays. Under reduced motion it plays none:
 * the step still changes visibility, in the same order, just without motion.
 * Appear has no animation, so it shows at once.
 */
export function revealAnimationValue(
  type: AnimationType,
  reducedMotion: boolean,
): string {
  if (reducedMotion || type === "appear") return "";
  if (type === "fade") return FADE_REVEAL;
  return getElementAnimationValue(type);
}

/**
 * Moves mounted step elements to `buildStep`. Only steps entering now (index in
 * [previousStep, buildStep)) get their reveal. Other steps keep their state, so
 * a press never replays a reveal that already ran. `previousStep` is null for a
 * freshly mounted DOM, and then nothing animates. `reducedMotion` defaults to the
 * user's preference, so a caller that omits it still gets no motion under it.
 */
export function setBuildState(
  elements: ReadonlyArray<Element | null>,
  steps: ReadonlyArray<SlideAnimation>,
  buildStep: number,
  previousStep: number | null,
  reducedMotion = prefersReducedMotion(),
): void {
  elements.forEach((element, index) => {
    if (!element) return;
    const entering =
      previousStep !== null && index >= previousStep && index < buildStep;
    const state =
      index >= buildStep ? "hidden" : entering ? "entering" : "shown";
    if (element.getAttribute("data-pstep-state") === state) return;
    element.setAttribute("data-pstep-state", state);
    // Setting the reveal starts it once. Clearing it on leave means a later
    // backward or forward press does not replay a keyframe that already ended.
    // A step still running when the next press arrives leaves "entering" here,
    // so clearing its animation snaps it to the shown state at once.
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      element.style.animation =
        state === "entering"
          ? revealAnimationValue(steps[index]?.type ?? "appear", reducedMotion)
          : "";
    }
  });
}
