import type {
  MotionPrototypeDirection,
  MotionPrototypeEase,
  MotionPrototypeNavigationTransition,
} from "@shared/motion-prototype-transition";
import { validateMotionPrototypeNavigationTransition } from "@shared/motion-prototype-transition";
import { flushSync } from "react-dom";

type PrototypeTransitionDocument = Pick<Document, "querySelector">;
type TransitionRun = { generation: number; animation?: Animation };

export type PrototypeNavigationTransitionResult =
  | "instant"
  | "animated"
  | "browser-fallback"
  | "unsupported-transition";

const PREVIEW_FRAME_SELECTOR = "iframe[data-an-prototype-preview]";
const DIRECTION_OFFSETS: Record<
  MotionPrototypeDirection,
  readonly [string, string, string, string]
> = {
  left: ["-100%", "0%", "100%", "0%"],
  right: ["100%", "0%", "-100%", "0%"],
  top: ["0%", "-100%", "0%", "100%"],
  bottom: ["0%", "100%", "0%", "-100%"],
};
const transitionRuns = new WeakMap<object, TransitionRun>();

function beginTransitionRun(documentRef: PrototypeTransitionDocument): number {
  const previous = transitionRuns.get(documentRef);
  if (previous) {
    previous.generation += 1;
    previous.animation?.cancel();
    previous.animation = undefined;
    return previous.generation;
  }

  transitionRuns.set(documentRef, { generation: 1 });
  return 1;
}

function isCurrentTransitionRun(
  documentRef: PrototypeTransitionDocument,
  generation: number,
): boolean {
  return transitionRuns.get(documentRef)?.generation === generation;
}

function setRunAnimation(
  documentRef: PrototypeTransitionDocument,
  generation: number,
  animation: Animation | undefined,
): void {
  const run = transitionRuns.get(documentRef);
  if (run?.generation === generation) run.animation = animation;
}

function easeToCss(ease: MotionPrototypeEase): string {
  if (ease.kind === "preset") return ease.preset;
  return `cubic-bezier(${ease.x1}, ${ease.y1}, ${ease.x2}, ${ease.y2})`;
}

function transitionKeyframes(
  transition: MotionPrototypeNavigationTransition,
  phase: "enter" | "exit",
): Keyframe[] {
  if (transition.transition === "dissolve") {
    return phase === "enter"
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 1 }, { opacity: 0 }];
  }

  const [enterX, enterY, exitX, exitY] = transition.direction
    ? DIRECTION_OFFSETS[transition.direction]
    : ["0%", "0%", "0%", "0%"];
  const offsetX =
    phase === "exit" && transition.transition === "push" ? exitX : enterX;
  const offsetY =
    phase === "exit" && transition.transition === "push" ? exitY : enterY;
  const transform = `translate(${offsetX}, ${offsetY})`;

  return phase === "enter"
    ? [{ transform }, { transform: "translate(0%, 0%)" }]
    : [
        { transform: "translate(0%, 0%)" },
        {
          transform:
            transition.transition === "push"
              ? transform
              : `translate(${enterX}, ${enterY})`,
        },
      ];
}

function startFrameAnimation(
  frame: HTMLIFrameElement,
  transition: MotionPrototypeNavigationTransition,
  phase: "enter" | "exit",
  durationMs: number,
): Animation {
  return frame.animate(transitionKeyframes(transition, phase), {
    duration: durationMs,
    easing: easeToCss(transition.ease!),
    fill: "both",
  });
}

function animateEntry(
  transition: MotionPrototypeNavigationTransition,
  update: () => void,
  documentRef: PrototypeTransitionDocument,
  durationMs: number,
  generation: number,
): PrototypeNavigationTransitionResult {
  flushSync(update);
  const frame = documentRef.querySelector<HTMLIFrameElement>(
    PREVIEW_FRAME_SELECTOR,
  );
  if (!frame || typeof frame.animate !== "function") {
    return "browser-fallback";
  }

  try {
    const animation = startFrameAnimation(
      frame,
      transition,
      "enter",
      durationMs,
    );
    setRunAnimation(documentRef, generation, animation);
    void animation.finished.then(
      () => {
        animation.cancel();
        setRunAnimation(documentRef, generation, undefined);
      },
      () => {},
    );
    return "animated";
  } catch {
    return "browser-fallback";
  }
}

function animateExit(
  transition: MotionPrototypeNavigationTransition,
  update: () => void,
  documentRef: PrototypeTransitionDocument,
  durationMs: number,
  continueWithEntry: boolean,
  generation: number,
): PrototypeNavigationTransitionResult {
  const frame = documentRef.querySelector<HTMLIFrameElement>(
    PREVIEW_FRAME_SELECTOR,
  );
  if (!frame || typeof frame.animate !== "function") {
    flushSync(update);
    return "browser-fallback";
  }

  let animation: Animation;
  try {
    animation = startFrameAnimation(frame, transition, "exit", durationMs);
  } catch {
    flushSync(update);
    return "browser-fallback";
  }

  setRunAnimation(documentRef, generation, animation);
  void animation.finished.then(
    () => {
      animation.cancel();
      if (!isCurrentTransitionRun(documentRef, generation)) return;
      setRunAnimation(documentRef, generation, undefined);
      if (continueWithEntry) {
        animateEntry(
          transition,
          update,
          documentRef,
          transition.durationMs! - durationMs,
          generation,
        );
      } else {
        flushSync(update);
      }
    },
    () => {
      if (isCurrentTransitionRun(documentRef, generation)) {
        setRunAnimation(documentRef, generation, undefined);
        flushSync(update);
      }
    },
  );
  return "animated";
}

/** Animates the preview frame around a code-authored screen navigation. */
export function runPrototypeNavigationTransition(
  transition: MotionPrototypeNavigationTransition | undefined,
  update: () => void,
  documentRef: PrototypeTransitionDocument | undefined = typeof document ===
  "undefined"
    ? undefined
    : document,
): PrototypeNavigationTransitionResult {
  const generation = documentRef ? beginTransitionRun(documentRef) : 0;
  if (!transition) {
    update();
    return "instant";
  }

  const validation = validateMotionPrototypeNavigationTransition(transition);
  if (!validation.valid) {
    update();
    return "unsupported-transition";
  }
  const config = validation.transition;
  if (config.transition === "instant") {
    update();
    return "instant";
  }
  if (config.transition === "smart-animate") {
    update();
    return "unsupported-transition";
  }
  if (!documentRef) {
    update();
    return "browser-fallback";
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return "browser-fallback";
  }

  const durationMs = config.durationMs!;
  const staged =
    config.transition === "dissolve" || config.transition === "push";
  const exitsFirst =
    staged ||
    config.transition === "move-out" ||
    config.transition === "slide-out";
  if (exitsFirst) {
    const exitDuration = staged ? durationMs / 2 : durationMs;
    return animateExit(
      config,
      update,
      documentRef,
      exitDuration,
      staged,
      generation,
    );
  }

  return animateEntry(config, update, documentRef, durationMs, generation);
}
