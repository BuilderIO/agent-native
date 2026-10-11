import {
  normalizeSharedSlideAnimations,
  type SharedSlideAnimationIssue,
} from "@shared/api";
import { parseHTML } from "linkedom/worker";

import { resolveRevealSteps } from "../../app/lib/slide-animation-elements.js";

/**
 * Why each stored reveal of a slide does not resolve, keyed by stored position.
 * Pass the result to toSharedDeckSlide as `revealIssues`. Parsing the slide
 * HTML stays on the server so the shared mapping remains DOM-free.
 */
export function slideRevealIssues(slide: unknown): SharedSlideAnimationIssue[] {
  const record: Record<string, unknown> =
    slide && typeof slide === "object"
      ? (slide as Record<string, unknown>)
      : {};
  const { animations, storedIndices } = normalizeSharedSlideAnimations(
    Array.isArray(record.animations) ? record.animations : [],
  );
  if (animations.length === 0) return [];

  const content = typeof record.content === "string" ? record.content : "";
  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${content}</body></html>`,
  );
  const root = document.querySelector(".fmd-slide");

  return resolveRevealSteps(root, animations).flatMap((outcome) =>
    outcome.ok
      ? []
      : [
          {
            index: storedIndices[outcome.animationIndex]!,
            id: outcome.id,
            code: outcome.reason,
          },
        ],
  );
}
