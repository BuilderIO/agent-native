// @vitest-environment happy-dom

import type { MotionPrototypeNavigationTransition } from "@shared/motion-prototype-transition";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelPrototypeNavigationTransition,
  runPrototypeNavigationTransition,
} from "./prototype-navigation-transition";

const instant: MotionPrototypeNavigationTransition = {
  version: 1,
  trigger: "click",
  action: "navigate",
  transition: "instant",
};
const dissolve: MotionPrototypeNavigationTransition = {
  ...instant,
  transition: "dissolve",
  durationMs: 420,
  ease: { kind: "preset", preset: "ease-in-out" },
};

function deferredAnimation() {
  let finish!: () => void;
  let fail!: () => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const cancel = vi.fn();
  return {
    animation: { finished, cancel } as unknown as Animation,
    cancel,
    finish,
    fail,
  };
}

describe("runPrototypeNavigationTransition", () => {
  let frame: HTMLIFrameElement;
  let animations: ReturnType<typeof deferredAnimation>[];
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    animations = [];
    frame = document.createElement("iframe");
    frame.dataset.anPrototypePreview = "";
    animate = vi.fn((..._args: unknown[]) => {
      const next = deferredAnimation();
      animations.push(next);
      return next.animation;
    });
    Object.defineProperty(frame, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: { readyState: "complete" },
    });
    document.body.append(frame);
  });

  afterEach(() => {
    frame.remove();
    vi.restoreAllMocks();
  });

  it("keeps missing and instant transitions immediate", () => {
    const update = vi.fn();

    expect(runPrototypeNavigationTransition(undefined, update)).toBe("instant");
    expect(runPrototypeNavigationTransition(instant, update)).toBe("instant");
    expect(update).toHaveBeenCalledTimes(2);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not accept an invalid document just because it says instant", () => {
    const update = vi.fn();

    expect(
      runPrototypeNavigationTransition(
        {
          ...instant,
          version: 2,
        } as unknown as MotionPrototypeNavigationTransition,
        update,
      ),
    ).toBe("unsupported-transition");
    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("updates the screen then animates its entrance with the explicit timing", async () => {
    const update = vi.fn();
    const transition: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "move-in",
      direction: "right",
      durationMs: 615,
      ease: { kind: "custom-bezier", x1: 0.2, y1: 0.7, x2: 0.3, y2: 1 },
    };

    expect(runPrototypeNavigationTransition(transition, update)).toBe(
      "animated",
    );
    expect(update).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translate(100%, 0%)" },
        { transform: "translate(0%, 0%)" },
      ],
      {
        duration: 615,
        easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
        fill: "both",
      },
    );

    animations[0]!.finish();
    await Promise.resolve();
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
  });

  it("waits for the destination preview frame to load before animating its entrance", () => {
    const entrance: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "move-in",
      direction: "left",
      durationMs: 420,
      ease: dissolve.ease,
    };
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: { readyState: "loading" },
    });
    const update = vi.fn();

    expect(runPrototypeNavigationTransition(entrance, update)).toBe("animated");
    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();

    frame.dispatchEvent(new Event("load"));
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translate(-100%, 0%)" },
        { transform: "translate(0%, 0%)" },
      ],
      { duration: 420, easing: "ease-in-out", fill: "both" },
    );
  });

  it("does not animate a still-loaded iframe document after its source changes", () => {
    const entrance: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "move-in",
      direction: "left",
      durationMs: 420,
      ease: dissolve.ease,
    };
    frame.setAttribute("srcdoc", "<p>old destination</p>");
    const previousDocument = { readyState: "complete", URL: "about:srcdoc" };
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: previousDocument,
    });
    const update = vi.fn(() =>
      frame.setAttribute("srcdoc", "<p>new destination</p>"),
    );

    expect(runPrototypeNavigationTransition(entrance, update)).toBe("animated");
    expect(animate).not.toHaveBeenCalled();

    frame.dispatchEvent(new Event("load"));
    expect(animate).toHaveBeenCalledOnce();
  });

  it("falls back immediately when the destination iframe source is invalid", () => {
    const transition: MotionPrototypeNavigationTransition = {
      ...dissolve,
      transition: "move-in",
      direction: "left",
    };
    const update = vi.fn(() => {
      frame.setAttribute("src", "http://[");
      Object.defineProperty(frame, "contentDocument", {
        configurable: true,
        value: { readyState: "complete", URL: "about:blank" },
      });
    });

    expect(runPrototypeNavigationTransition(transition, update)).toBe(
      "browser-fallback",
    );
    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("removes a pending entrance load listener when a manual action cancels it", () => {
    const entrance: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "move-in",
      direction: "left",
      durationMs: 420,
      ease: dissolve.ease,
    };
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: { readyState: "loading" },
    });
    const update = vi.fn();

    expect(runPrototypeNavigationTransition(entrance, update)).toBe("animated");
    cancelPrototypeNavigationTransition();
    frame.dispatchEvent(new Event("load"));

    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("fades the current screen out before fading the next screen in", async () => {
    const update = vi.fn();

    expect(runPrototypeNavigationTransition(dissolve, update)).toBe("animated");
    expect(update).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], {
      duration: 210,
      easing: "ease-in-out",
      fill: "both",
    });

    animations[0]!.finish();
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
      duration: 210,
      easing: "ease-in-out",
      fill: "both",
    });

    animations[1]!.finish();
    await Promise.resolve();
    expect(
      animations.every(({ cancel }) => cancel.mock.calls.length === 1),
    ).toBe(true);
  });

  it("waits for an outgoing motion to finish before switching screens", async () => {
    const update = vi.fn();
    const transition: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "move-out",
      direction: "left",
      durationMs: 360,
      ease: { kind: "preset", preset: "linear" },
    };

    expect(runPrototypeNavigationTransition(transition, update)).toBe(
      "animated",
    );
    expect(update).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translate(0%, 0%)" },
        { transform: "translate(-100%, 0%)" },
      ],
      { duration: 360, easing: "linear", fill: "both" },
    );

    animations[0]!.finish();
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
  });

  it("pushes the current frame out before bringing in the next frame", async () => {
    const update = vi.fn();
    const transition: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "push",
      direction: "bottom",
      durationMs: 615,
      ease: { kind: "preset", preset: "ease" },
    };

    expect(runPrototypeNavigationTransition(transition, update)).toBe(
      "animated",
    );
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translate(0%, 0%)" },
        { transform: "translate(0%, -100%)" },
      ],
      { duration: 307.5, easing: "ease", fill: "both" },
    );
    expect(update).not.toHaveBeenCalled();

    animations[0]!.finish();
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenLastCalledWith(
      [
        { transform: "translate(0%, 100%)" },
        { transform: "translate(0%, 0%)" },
      ],
      { duration: 307.5, easing: "ease", fill: "both" },
    );

    animations[1]!.finish();
    await Promise.resolve();
    expect(
      animations.every(({ cancel }) => cancel.mock.calls.length === 1),
    ).toBe(true);
  });

  it("animates the message source frame and the matching destination frame", async () => {
    const sourceAnimation = deferredAnimation();
    const destinationAnimation = deferredAnimation();
    const sourceFrame = document.createElement("iframe");
    sourceFrame.dataset.anPrototypePreview = "";
    sourceFrame.dataset.screenIframeId = "source";
    const sourceAnimate = vi.fn(() => sourceAnimation.animation);
    Object.defineProperty(sourceFrame, "animate", {
      configurable: true,
      value: sourceAnimate,
    });
    Object.defineProperty(sourceFrame, "contentDocument", {
      configurable: true,
      value: { readyState: "complete" },
    });

    const destinationFrame = document.createElement("iframe");
    destinationFrame.dataset.anPrototypePreview = "";
    destinationFrame.dataset.screenIframeId = "target";
    const destinationAnimate = vi.fn(() => destinationAnimation.animation);
    Object.defineProperty(destinationFrame, "animate", {
      configurable: true,
      value: destinationAnimate,
    });
    Object.defineProperty(destinationFrame, "contentDocument", {
      configurable: true,
      value: { readyState: "complete" },
    });
    document.body.append(sourceFrame, destinationFrame);

    const update = vi.fn();
    expect(
      runPrototypeNavigationTransition(dissolve, update, document, {
        sourceFrame,
        destinationFrameId: "target",
      }),
    ).toBe("animated");
    expect(animate).not.toHaveBeenCalled();
    expect(sourceAnimate).toHaveBeenCalledWith(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 210, easing: "ease-in-out", fill: "both" },
    );
    expect(destinationAnimate).not.toHaveBeenCalled();

    sourceAnimation.finish();
    await Promise.resolve();

    expect(update).toHaveBeenCalledOnce();
    expect(sourceAnimation.cancel).toHaveBeenCalledOnce();
    expect(destinationAnimate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 210, easing: "ease-in-out", fill: "both" },
    );
    sourceFrame.remove();
    destinationFrame.remove();
  });

  it("retains the exit effect until a loading destination starts entering", async () => {
    frame.dataset.screenIframeId = "source";
    const destinationFrame = document.createElement("iframe");
    destinationFrame.dataset.anPrototypePreview = "";
    destinationFrame.dataset.screenIframeId = "target";
    const destinationAnimation = deferredAnimation();
    const destinationAnimate = vi.fn(() => destinationAnimation.animation);
    Object.defineProperty(destinationFrame, "animate", {
      configurable: true,
      value: destinationAnimate,
    });
    const previousDestinationDocument = {
      readyState: "complete",
      URL: "about:srcdoc",
    };
    destinationFrame.setAttribute("srcdoc", "<p>old target</p>");
    Object.defineProperty(destinationFrame, "contentDocument", {
      configurable: true,
      value: previousDestinationDocument,
    });
    document.body.append(destinationFrame);

    const update = vi.fn(() => {
      destinationFrame.setAttribute("srcdoc", "<p>new target</p>");
    });
    expect(
      runPrototypeNavigationTransition(dissolve, update, document, {
        sourceFrame: frame,
        destinationFrameId: "target",
      }),
    ).toBe("animated");

    animations[0]!.finish();
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(animations[0]!.cancel).not.toHaveBeenCalled();
    expect(destinationAnimate).not.toHaveBeenCalled();

    Object.defineProperty(destinationFrame, "contentDocument", {
      configurable: true,
      value: { readyState: "complete", URL: "about:srcdoc" },
    });
    destinationFrame.dispatchEvent(new Event("load"));

    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(destinationAnimate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 210, easing: "ease-in-out", fill: "both" },
    );
    destinationFrame.remove();
  });

  it("fails closed for smart animate until matched layers can be tweened", () => {
    const update = vi.fn();

    expect(
      runPrototypeNavigationTransition(
        { ...dissolve, transition: "smart-animate" },
        update,
      ),
    ).toBe("unsupported-transition");
    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("still navigates immediately when the preview frame cannot animate", () => {
    frame.remove();
    const update = vi.fn();

    expect(runPrototypeNavigationTransition(dissolve, update, document)).toBe(
      "browser-fallback",
    );
    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not strand navigation if an outgoing animation is interrupted", async () => {
    const update = vi.fn();

    expect(
      runPrototypeNavigationTransition(
        { ...dissolve, transition: "move-out", direction: "right" },
        update,
      ),
    ).toBe("animated");
    animations[0]!.cancel();
    animations[0]!.fail();
    await Promise.resolve();

    expect(update).toHaveBeenCalledOnce();
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
  });

  it("ignores a canceled transition after a newer navigation starts", async () => {
    const staleUpdate = vi.fn();
    const currentUpdate = vi.fn();
    const transition: MotionPrototypeNavigationTransition = {
      ...instant,
      transition: "move-out",
      direction: "left",
      durationMs: 360,
      ease: { kind: "preset", preset: "linear" },
    };

    expect(runPrototypeNavigationTransition(transition, staleUpdate)).toBe(
      "animated",
    );
    expect(runPrototypeNavigationTransition(undefined, currentUpdate)).toBe(
      "instant",
    );
    animations[0]!.fail();
    await Promise.resolve();

    expect(staleUpdate).not.toHaveBeenCalled();
    expect(currentUpdate).toHaveBeenCalledOnce();
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
  });
});
