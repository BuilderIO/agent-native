import { parseHTML } from "linkedom/worker";

import {
  animationElementKey,
  getElementPath,
  getElementPreview,
  resolveSlideAnimationElement,
  resolveSlideAnimationTargetsWithDiagnostics,
  type AnimationTarget,
} from "../../app/lib/slide-animation-elements.js";

interface SlideAnimation extends AnimationTarget {
  id?: string;
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

export function summarizeSlideAnimationTargets(
  content: string,
  animations: readonly SlideAnimation[],
): SlideAnimationTargetSummary[] {
  if (animations.length === 0) return [];

  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${content}</body></html>`,
  );
  const root = document.querySelector(".fmd-slide");
  if (!root) {
    return animations.map(() => ({
      targetPreview: null,
      resolvedPath: null,
      targetValid: false,
      targetIssue: "missing-slide-root",
    }));
  }

  const seen = new Set<string>();
  return animations.map((target) => {
    const element = resolveSlideAnimationElement(root, target);
    if (!element) {
      return {
        targetPreview: null,
        resolvedPath: null,
        targetValid: false,
        targetIssue: "target-not-found",
      };
    }

    const path = getElementPath(root, element);
    if (!path) {
      return {
        targetPreview: getElementPreview(
          element,
          `Element ${target.elementIndex + 1}`,
        ),
        resolvedPath: null,
        targetValid: false,
        targetIssue: "target-not-found",
      };
    }

    const key = animationElementKey(path);
    if (seen.has(key)) {
      return {
        targetPreview: getElementPreview(
          element,
          `Element ${target.elementIndex + 1}`,
        ),
        resolvedPath: key,
        targetValid: false,
        targetIssue: "duplicate-target",
      };
    }

    seen.add(key);
    return {
      targetPreview: getElementPreview(
        element,
        `Element ${target.elementIndex + 1}`,
      ),
      resolvedPath: key,
      targetValid: true,
      targetIssue: null,
    };
  });
}

/**
 * Validate animation identity against the exact HTML that is about to be
 * persisted. Playback cannot repair a stale path without risking a different
 * element being revealed, so reject the mutation before the deck is written.
 */
export function assertSlideAnimationsResolve({
  slideId,
  content,
  animations,
  requireElementPaths = false,
}: {
  slideId: string;
  content: string;
  animations: readonly SlideAnimation[];
  requireElementPaths?: boolean;
}): void {
  if (animations.length === 0) return;

  if (requireElementPaths) {
    const legacyIndex = animations.findIndex(
      (animation) => !Array.isArray(animation.elementPath),
    );
    if (legacyIndex !== -1) {
      const target = animations[legacyIndex];
      throw new Error(
        `Cannot save animations for slide ${slideId}: ${target ? formatTarget(target) : `step ${legacyIndex + 1}`} is missing elementPath. Agent-created or content-revised animations must use a path from the final HTML; elementIndex-only targets are legacy-only.`,
      );
    }
  }

  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${content}</body></html>`,
  );
  const root = document.querySelector(".fmd-slide");
  if (!root) {
    throw new Error(
      `Cannot save animations for slide ${slideId}: the final HTML has no .fmd-slide wrapper. Re-read the slide content, then send the content and complete animation list together.`,
    );
  }

  const resolution = resolveSlideAnimationTargetsWithDiagnostics(
    root,
    animations,
  );
  const issue = resolution.issue;
  if (!issue) return;

  const target = animations[issue.animationIndex];
  const targetDescription = target ? formatTarget(target) : "unknown step";
  if (issue.code === "duplicate-target") {
    throw new Error(
      `Cannot save animations for slide ${slideId}: ${targetDescription} duplicates target path ${issue.key ?? "unknown"}${issue.preview ? ` (${issue.preview})` : ""}. Each reveal step must target a different element; re-read the final HTML and send the complete ordered list.`,
    );
  }

  throw new Error(
    `Cannot save animations for slide ${slideId}: ${targetDescription} does not resolve in the final HTML. Do not fall back to elementIndex; re-read the final HTML and send the content and complete ordered animation list together.`,
  );
}
