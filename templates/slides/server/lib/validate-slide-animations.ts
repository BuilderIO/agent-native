import { fail } from "@agent-native/core/action";
import { parseHTML } from "linkedom/worker";

import {
  animationElementKey,
  getElementPreview,
  getPersistedChildren,
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

// Node.TEXT_NODE; the global Node is not defined where this validator runs.
const TEXT_NODE = 3;

function persistedDescendants(root: Element): Element[] {
  const elements: Element[] = [];
  const visit = (parent: Element) => {
    for (const child of getPersistedChildren(parent)) {
      elements.push(child);
      visit(child);
    }
  };
  visit(root);
  return elements;
}

// Tag, class, and the element's own text. Text inside child elements is left out,
// so an edit deep in a container does not change the container's identity.
function elementSignature(element: Element): string {
  const ownText = Array.from(element.childNodes)
    .filter((node) => node.nodeType === TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("");
  return JSON.stringify([
    element.tagName.toLowerCase(),
    element.getAttribute("class") ?? "",
    ownText.replace(/\s+/g, " ").trim(),
  ]);
}

function tagAndClass(element: Element): string {
  return JSON.stringify([
    element.tagName.toLowerCase(),
    element.getAttribute("class") ?? "",
  ]);
}

/**
 * Pairs an unequal run only where the pairing is certain: a baseline element takes
 * the one unclaimed element of its tag and class, and only when that element is
 * unique. Text is not used. An inserted sibling can keep the target's text, and a
 * revised target can share its tag and class with an appended sibling, so text cannot
 * tell which element the target became. Anything ambiguous stays unpaired, and an
 * unpaired reveal is refused as a retarget instead of silently rebinding.
 */
function pairUnequalRun(
  before: Element[],
  after: Element[],
  identities: Map<Element, Element>,
): void {
  const claimed = new Set<Element>();
  for (const element of before) {
    const key = tagAndClass(element);
    // Both sides must hold exactly one element of this tag and class. With two
    // baseline siblings of one tag and class, a deleted one can look paired to the
    // survivor, so the element stays unpaired.
    if (before.filter((other) => tagAndClass(other) === key).length !== 1) {
      continue;
    }
    const candidates = after.filter(
      (candidate) => !claimed.has(candidate) && tagAndClass(candidate) === key,
    );
    if (candidates.length !== 1) continue;
    identities.set(element, candidates[0]!);
    claimed.add(candidates[0]!);
  }
}

/**
 * Pairs each element of the baseline with the element it became after an edit,
 * or leaves it unpaired. Exact matches anchor a longest common subsequence in
 * document order. Between two anchors, elements pair up in order when both runs
 * hold the same number of elements; otherwise pairUnequalRun pairs only the
 * unambiguous tag-and-class matches. A text edit keeps its identity when the runs
 * are equal, while an inserted, removed, or reordered sibling breaks the pairing.
 * Identical siblings are interchangeable by content, so an insertion among them can
 * still pick the wrong match.
 */
function elementIdentities(
  baseline: Element,
  post: Element,
): Map<Element, Element> {
  const before = persistedDescendants(baseline);
  const after = persistedDescendants(post);
  const beforeKeys = before.map(elementSignature);
  const afterKeys = after.map(elementSignature);
  const n = before.length;
  const m = after.length;

  // ponytail: quadratic in one slide's element count; slides are small. Upgrade to
  // a diff library if a slide ever grows into thousands of elements.
  // common[i][j]: longest common subsequence of beforeKeys[i..] and afterKeys[j..].
  const common = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i]![j] =
        beforeKeys[i] === afterKeys[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const anchors: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (beforeKeys[i] === afterKeys[j]) {
      anchors.push([i, j]);
      i++;
      j++;
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }

  const identities = new Map<Element, Element>();
  let fromBefore = 0;
  let fromAfter = 0;
  for (const [i, j] of [...anchors, [n, m] as [number, number]]) {
    const gapBefore = before.slice(fromBefore, i);
    const gapAfter = after.slice(fromAfter, j);
    if (gapBefore.length === gapAfter.length) {
      gapBefore.forEach((element, k) => identities.set(element, gapAfter[k]!));
    } else {
      pairUnequalRun(gapBefore, gapAfter, identities);
    }
    if (i < n) identities.set(before[i]!, after[j]!);
    fromBefore = i + 1;
    fromAfter = j + 1;
  }
  return identities;
}

/**
 * The index of the first kept reveal, or -1. A kept reveal has the same id, index,
 * and path as a baseline reveal. Its path can still resolve after a sibling moves in
 * front of the target, so the path alone cannot prove the target is the same element;
 * the alignment has to. A baseline reveal that did not resolve has no target to keep,
 * so once it resolves under the same path, the content has moved into that path.
 */
function retargetedRevealIndex(
  baseline: SlideAnimationBaseline,
  root: Element,
  animations: readonly SlideAnimation[],
): number {
  const baselineRoot = slideRootOf(baseline.content);
  if (!baselineRoot) return -1;
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
  const identities = elementIdentities(baselineRoot, root);
  return resolveRevealSteps(root, animations).findIndex((outcome, index) => {
    if (!outcome.ok) return false;
    const prior = priorTargets.get(revealIdentity(animations[index]!));
    if (prior === undefined) return false;
    if (prior === null) return true;
    if (identities.get(prior) !== outcome.element) return true;
    // Identical siblings are interchangeable by content. Once the sibling count
    // changed, a copy of the target's text can be the element the pairing picked, so
    // the save is refused rather than guessed.
    const parent = outcome.element.parentElement;
    if (!parent) return false;
    const signature = elementSignature(outcome.element);
    const identical = Array.from(parent.children).filter(
      (child) => elementSignature(child) === signature,
    ).length;
    return (
      identical > 1 &&
      prior.parentElement?.children.length !== parent.children.length
    );
  });
}

// The same resolver the editor and the runtime use, so a save rejects exactly
// what playback would fail to resolve, including "By paragraph" expansion.
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

/**
 * Refuses a save whose reveal list introduces a reveal that does not resolve.
 * A reveal the baseline already had unresolved (same id, same target) may stay
 * or leave the list, so a partial repair saves; only a new unresolved reveal,
 * or one a content change strands or retargets, is refused.
 */
export function assertSlideAnimationsResolve({
  slideId,
  content,
  animations,
  requireElementPaths = false,
  baseline,
}: {
  slideId: string;
  content: string;
  animations: readonly SlideAnimation[];
  requireElementPaths?: boolean;
  baseline?: SlideAnimationBaseline;
}): void {
  if (animations.length === 0) return;

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

  const root = slideRootOf(content);
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
    if (retargeted === -1) return;
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
