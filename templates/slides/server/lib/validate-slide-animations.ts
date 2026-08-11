import { parseHTML } from "linkedom/worker";

import {
  resolveSlideAnimationTargetsWithDiagnostics,
  type AnimationTarget,
} from "../../app/lib/slide-animation-elements.js";

interface SlideAnimation extends AnimationTarget {
  id?: string;
}

function formatTarget(target: SlideAnimation): string {
  const id = target.id ? ` (${target.id})` : "";
  const path = Array.isArray(target.elementPath)
    ? ` path [${target.elementPath.join(", ")}]`
    : "";
  return `step ${target.elementIndex + 1}${id}${path}`;
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
}: {
  slideId: string;
  content: string;
  animations: readonly SlideAnimation[];
}): void {
  if (animations.length === 0) return;

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
