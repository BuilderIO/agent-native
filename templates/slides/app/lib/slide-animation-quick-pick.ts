import { nanoid } from "nanoid";

import type { AnimationType, SlideAnimation } from "@/context/DeckContext";

import {
  animationElementKey,
  getSlideAnimationTargetKeyIn,
  resolveRevealSteps,
  type RevealUnresolvedReason,
  type SelectedAnimationTarget,
} from "./slide-animation-elements";

export const REVEAL_REASON_LABEL_KEY: Record<RevealUnresolvedReason, string> = {
  "stale-path": "animations.issueStalePath",
  "missing-element": "animations.issueMissingElement",
  "duplicate-after-expansion": "animations.issueDuplicate",
};

// Same rule as server/lib/validate-slide-animations.ts: a reveal keeps its identity
// while its id and target stay the same.
function revealIdentity(animation: SlideAnimation): string {
  return JSON.stringify([
    animation.id,
    animation.elementIndex,
    animation.elementPath ?? null,
  ]);
}

/**
 * Why `next` is refused, or null. A list is refused only when it introduces a
 * reveal that does not resolve: one the stored list already had unresolved may
 * stay or leave, so a partial repair saves.
 */
export function introducedUnresolvedReason(
  root: Element | null,
  current: readonly SlideAnimation[],
  next: readonly SlideAnimation[],
): RevealUnresolvedReason | null {
  const alreadyUnresolved = new Set(
    resolveRevealSteps(root, current).flatMap((outcome, index) =>
      outcome.ok ? [] : [revealIdentity(current[index]!)],
    ),
  );
  for (const [index, outcome] of resolveRevealSteps(root, next).entries()) {
    if (outcome.ok || alreadyUnresolved.has(revealIdentity(next[index]!))) {
      continue;
    }
    return outcome.reason;
  }
  return null;
}

function parseSlideRoot(content: string): Element | null {
  return new DOMParser()
    .parseFromString(content, "text/html")
    .querySelector(".fmd-slide");
}

function animationInRoot(
  root: Element | null,
  animations: readonly SlideAnimation[],
  target: SelectedAnimationTarget,
): SlideAnimation | null {
  const key = animationElementKey(target.elementPath);
  return (
    animations.find(
      (animation) => getSlideAnimationTargetKeyIn(root, animation) === key,
    ) ?? null
  );
}

export function animationOfTarget(
  content: string,
  animations: readonly SlideAnimation[],
  target: SelectedAnimationTarget,
): SlideAnimation | null {
  return animationInRoot(parseSlideRoot(content), animations, target);
}

/** A new reveal of `type` for the element at `target`. */
export function createElementAnimation(
  target: SelectedAnimationTarget,
  type: AnimationType,
): SlideAnimation {
  return {
    id: nanoid(6),
    elementIndex: target.elementIndex,
    elementPath: target.elementPath,
    type,
  };
}

export type ElementAnimationPlan =
  | { ok: true; animations: SlideAnimation[] }
  | { ok: false; reason: RevealUnresolvedReason };

/** The animation list after giving `target` the animation `type`, or none. */
export function planElementAnimation({
  content,
  animations,
  target,
  type,
}: {
  content: string;
  animations: readonly SlideAnimation[];
  target: SelectedAnimationTarget;
  type: AnimationType | "none";
}): ElementAnimationPlan {
  const root = parseSlideRoot(content);
  const existing = animationInRoot(root, animations, target);
  let next: SlideAnimation[];
  if (type === "none") {
    next = animations.filter((animation) => animation !== existing);
  } else if (existing) {
    next = animations.map((animation) =>
      animation === existing ? { ...animation, type } : animation,
    );
  } else {
    next = [...animations, createElementAnimation(target, type)];
  }
  const reason = introducedUnresolvedReason(root, animations, next);
  return reason ? { ok: false, reason } : { ok: true, animations: next };
}
