import { fail } from "@agent-native/core/action";
import { parseHTML } from "linkedom/worker";

import {
  matchSlideElements,
  revealsAfterRootEdit,
} from "../../app/lib/reveal-after-edit.js";
import {
  animationElementKey,
  getElementPreview,
  resolveRevealSteps,
  type AnimationTarget,
  type RevealOutcome,
  type RevealUnresolvedReason,
} from "../../app/lib/slide-animation-elements.js";

interface SlideAnimation extends AnimationTarget {
  id?: string;
}

/** The stored content and reveal list that a save replaces. */
export interface SlideAnimationBaseline {
  content: string;
  animations: readonly SlideAnimation[];
}

/**
 * Why a save refuses a reveal list. Each is a 400 whose errorCode is
 * `slide_animation_<reason>` with the reason in details, so a caller can branch
 * on it instead of parsing the message.
 */
export type SlideAnimationRefusal =
  | RevealUnresolvedReason
  | "duplicate-id"
  | "element-path-required"
  | "retargeted";

function refuse(
  reason: SlideAnimationRefusal,
  message: string,
  details: Record<string, unknown>,
): never {
  return fail(message, {
    errorCode: `slide_animation_${reason.replace(/-/g, "_")}`,
    statusCode: 400,
    details: { reason, ...details },
  });
}

function firstRepeatedIdIndex(animations: readonly SlideAnimation[]): number {
  const seen = new Set<string>();
  return animations.findIndex((animation) => {
    if (animation.id === undefined) return false;
    if (seen.has(animation.id)) return true;
    seen.add(animation.id);
    return false;
  });
}

export interface SlideAnimationTargetSummary {
  targetPreview: string | null;
  resolvedPath: string | null;
  targetValid: boolean;
  targetIssue:
    | "missing-slide-root"
    | "target-not-found"
    | "duplicate-target"
    | null;
}

function formatTarget(target: SlideAnimation): string {
  const id = target.id ? ` (${target.id})` : "";
  const path = Array.isArray(target.elementPath)
    ? ` path [${target.elementPath.join(", ")}]`
    : "";
  return `step ${target.elementIndex + 1}${id}${path}`;
}

function slideRootOf(content: string) {
  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${content}</body></html>`,
  );
  return document.querySelector(".fmd-slide");
}

// A reveal keeps its identity across a save while its id and target stay the same.
// Client AnimationsPanel.tsx applies the same rule to its own list.
function revealIdentity(animation: SlideAnimation): string {
  return JSON.stringify([
    animation.id ?? null,
    animation.elementIndex,
    animation.elementPath ?? null,
  ]);
}

function unresolvedIdentities(baseline: SlideAnimationBaseline): Set<string> {
  const outcomes = resolveRevealSteps(
    slideRootOf(baseline.content),
    baseline.animations,
  );
  return new Set(
    outcomes.flatMap((outcome, index) =>
      outcome.ok ? [] : [revealIdentity(baseline.animations[index]!)],
    ),
  );
}

/**
 * The index of the first kept reveal that may now target a different element, or -1.
 * A kept reveal has the same id, index, and path as a baseline reveal; it stays
 * valid while it resolves to the element its baseline target became (see
 * matchSlideElements). A baseline reveal that did not resolve has no target to
 * keep, so once it resolves under the same path, the content moved in. A baseline
 * with no slide root has no targets at all, so every such reveal counts as
 * unresolved.
 */
function retargetedRevealIndex(
  baseline: SlideAnimationBaseline,
  root: Element,
  animations: readonly SlideAnimation[],
): number {
  const baselineRoot = slideRootOf(baseline.content);
  if (!baselineRoot) {
    const baselineIds = new Set(baseline.animations.map(revealIdentity));
    return resolveRevealSteps(root, animations).findIndex(
      (outcome, index) =>
        outcome.ok && baselineIds.has(revealIdentity(animations[index]!)),
    );
  }
  const matched = matchSlideElements(baselineRoot, root);
  // null marks a baseline reveal that did not resolve.
  const priorTargets = new Map<string, Element | null>();
  resolveRevealSteps(baselineRoot, baseline.animations).forEach(
    (outcome, index) => {
      priorTargets.set(
        revealIdentity(baseline.animations[index]!),
        outcome.ok ? outcome.element : null,
      );
    },
  );
  return resolveRevealSteps(root, animations).findIndex((outcome, index) => {
    if (!outcome.ok) return false;
    const prior = priorTargets.get(revealIdentity(animations[index]!));
    if (prior === undefined) return false;
    return prior === null || matched.get(prior) !== outcome.element;
  });
}

export function summarizeSlideAnimationTargets(
  content: string,
  animations: readonly SlideAnimation[],
): SlideAnimationTargetSummary[] {
  if (animations.length === 0) return [];

  const root = slideRootOf(content);
  if (!root) {
    return animations.map(() => ({
      targetPreview: null,
      resolvedPath: null,
      targetValid: false,
      targetIssue: "missing-slide-root",
    }));
  }

  return resolveRevealSteps(root, animations).map(
    (outcome): SlideAnimationTargetSummary => {
      if (outcome.ok) {
        const target = animations[outcome.animationIndex];
        return {
          targetPreview: getElementPreview(
            outcome.element,
            `Element ${(target?.elementIndex ?? 0) + 1}`,
          ),
          resolvedPath: animationElementKey(outcome.path),
          targetValid: true,
          targetIssue: null,
        };
      }
      return {
        targetPreview: outcome.preview,
        resolvedPath: outcome.path ? animationElementKey(outcome.path) : null,
        targetValid: false,
        targetIssue:
          outcome.reason === "duplicate-after-expansion"
            ? "duplicate-target"
            : "target-not-found",
      };
    },
  );
}

/** A kept reveal a content-only save moved to the path its target now has. */
export interface RepointedReveal {
  slideId: string;
  animationIndex: number;
  animationId: string | null;
  fromPath: number[] | null;
  toPath: number[];
}

/**
 * Returns the reveal list to save, refusing one that introduces a reveal that
 * does not resolve. A reveal the baseline already had unresolved (same id, same
 * target) may stay or leave the list, so a partial repair saves; only a new
 * unresolved reveal, or one a content change strands or retargets, is refused.
 * With `followContent` (the caller sent content but no reveal list), each kept
 * reveal first moves to the path of the element its target became, and every
 * such move is listed in `repointed` so the caller can report it.
 */
export function assertSlideAnimationsResolve<T extends SlideAnimation>({
  slideId,
  content,
  animations: requested,
  requireElementPaths = false,
  baseline,
  followContent = false,
}: {
  slideId: string;
  content: string;
  animations: readonly T[];
  requireElementPaths?: boolean;
  baseline?: SlideAnimationBaseline;
  followContent?: boolean;
}): { animations: T[]; repointed: RepointedReveal[] } {
  const root = slideRootOf(content);
  const baselineRoot =
    followContent && baseline && root ? slideRootOf(baseline.content) : null;
  const animations =
    baselineRoot && root
      ? revealsAfterRootEdit(baselineRoot, root, requested)
      : [...requested];
  const repointed: RepointedReveal[] = [];
  animations.forEach((animation, animationIndex) => {
    const before = requested.at(animationIndex);
    if (animation === before || !animation.elementPath) return;
    repointed.push({
      slideId,
      animationIndex,
      animationId: animation.id ?? null,
      fromPath: before?.elementPath ?? null,
      toPath: animation.elementPath,
    });
  });
  const result = { animations, repointed };
  if (animations.length === 0) return result;

  const repeatedIndex = firstRepeatedIdIndex(animations);
  if (repeatedIndex !== -1) {
    const target = animations[repeatedIndex]!;
    refuse(
      "duplicate-id",
      `Cannot save animations for slide ${slideId}: ${formatTarget(target)} repeats the id of an earlier reveal. Every reveal needs its own id; re-send the complete ordered list.`,
      {
        slideId,
        animationIndex: repeatedIndex,
        animationId: target.id,
      },
    );
  }

  if (requireElementPaths) {
    const legacyIndex = animations.findIndex(
      (animation) => !Array.isArray(animation.elementPath),
    );
    if (legacyIndex !== -1) {
      const target = animations[legacyIndex];
      refuse(
        "element-path-required",
        `Cannot save animations for slide ${slideId}: ${target ? formatTarget(target) : `step ${legacyIndex + 1}`} is missing elementPath. Agent-created or content-revised animations must use a path from the final HTML; elementIndex-only targets are legacy-only.`,
        {
          slideId,
          animationIndex: legacyIndex,
          animationId: target?.id ?? null,
        },
      );
    }
  }

  const alreadyUnresolved = baseline
    ? unresolvedIdentities(baseline)
    : new Set<string>();
  const failure = resolveRevealSteps(root, animations).find(
    (outcome, index): outcome is Extract<RevealOutcome, { ok: false }> =>
      !outcome.ok && !alreadyUnresolved.has(revealIdentity(animations[index]!)),
  );
  if (!failure) {
    const retargeted =
      baseline && root ? retargetedRevealIndex(baseline, root, animations) : -1;
    if (retargeted === -1) return result;
    const moved = animations[retargeted]!;
    refuse(
      "retargeted",
      `Cannot save animations for slide ${slideId}: ${formatTarget(moved)} now lands on a different element in the final HTML. A content change moved its target, for example by inserting, removing, or reordering a sibling before it. Re-read the final HTML and send the content and complete ordered animation list together.`,
      {
        slideId,
        animationIndex: retargeted,
        animationId: moved.id ?? null,
      },
    );
  }

  const target = animations[failure.animationIndex];
  const targetDescription = target ? formatTarget(target) : "unknown step";
  const details = {
    slideId,
    animationIndex: failure.animationIndex,
    animationId: failure.id,
    path: failure.path,
    preview: failure.preview,
  };
  if (!root) {
    refuse(
      "missing-element",
      `Cannot save animations for slide ${slideId}: the final HTML has no .fmd-slide wrapper. Re-read the slide content, then send the content and complete animation list together.`,
      details,
    );
  }
  if (failure.reason === "duplicate-after-expansion") {
    const path = failure.path ? animationElementKey(failure.path) : "unknown";
    refuse(
      failure.reason,
      `Cannot save animations for slide ${slideId}: ${targetDescription} duplicates target path ${path}${failure.preview ? ` (${failure.preview})` : ""}. A "By paragraph" reveal expands to its paragraphs, and no step may hide an element another reveal already hides, or one of its ancestors or descendants. Re-read the final HTML and send the complete ordered list.`,
      details,
    );
  }

  refuse(
    failure.reason,
    `Cannot save animations for slide ${slideId}: ${targetDescription} does not resolve in the final HTML (${failure.reason}). Do not fall back to elementIndex; re-read the final HTML and send the content and complete ordered animation list together.`,
    details,
  );
}
