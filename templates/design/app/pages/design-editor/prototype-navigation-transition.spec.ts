// @vitest-environment happy-dom

import type { MotionPrototypeNavigationTransition } from "@shared/motion-prototype-transition";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runPrototypeNavigationTransition } from "./prototype-navigation-transition";

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
