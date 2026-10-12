// @vitest-environment happy-dom

import type { MotionTextAnimation } from "@shared/motion-text-code";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MotionTextAnimationEditor } from "./MotionTextAnimationEditor";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const animation: MotionTextAnimation = {
  targetNodeId: "title-1",
  unit: "word",
  direction: "forward",
  staggerMs: 40,
  property: "opacity",
  durationMs: 600,
  keyframes: [
    { t: 0, value: "0", ease: "ease-out" },
    { t: 1, value: "1" },
  ],
};

describe("MotionTextAnimationEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.replaceChildren();
  });

  async function render(
    overrides: Partial<{
      animation: MotionTextAnimation;
      onChange: (next: MotionTextAnimation) => void;
      onRemove: () => void;
      disabled: boolean;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <MotionTextAnimationEditor
          animation={animation}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          t={(key) => key}
          {...overrides}
        />,
      );
    });
  }

  async function enterValue(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("renders localized controls for text timing, unit, direction, property, and keyframes", async () => {
    await render();

    expect(
      container.querySelector(
        '[aria-label="designEditor.motion.textAnimation.unit"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.motion.textAnimation.direction"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.motion.textAnimation.property"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "designEditor.motion.textAnimation.stagger",
    );
    expect(container.textContent).toContain(
      "designEditor.motion.textAnimation.duration",
    );
    expect(
      container.querySelector(
        'input[aria-label="designEditor.motion.textAnimation.keyframeValue 1"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'input[aria-label="designEditor.motion.textAnimation.keyframeEase 1"]',
      ),
    ).not.toBeNull();
  });

  it("reports immutable edits to duration, stagger, values, and easing", async () => {
    const onChange = vi.fn();
    await render({ onChange });

    const numberInputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    );
    await enterValue(numberInputs[0]!, "125");
    expect(onChange).toHaveBeenLastCalledWith({ ...animation, staggerMs: 125 });

    await enterValue(numberInputs[1]!, "900");
    expect(onChange).toHaveBeenLastCalledWith({
      ...animation,
      durationMs: 900,
    });

    await enterValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="designEditor.motion.textAnimation.keyframeValue 1"]',
      )!,
      "0.25",
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...animation,
      keyframes: [
        { t: 0, value: "0.25", ease: "ease-out" },
        animation.keyframes[1],
      ],
    });

    await enterValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="designEditor.motion.textAnimation.keyframeEase 2"]',
      )!,
      "linear",
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...animation,
      keyframes: [animation.keyframes[0], { t: 1, value: "1", ease: "linear" }],
    });
    expect(animation).toEqual({
      targetNodeId: "title-1",
      unit: "word",
      direction: "forward",
      staggerMs: 40,
      property: "opacity",
      durationMs: 600,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1" },
      ],
    });
  });

  it("removes the animation through the accessible action", async () => {
    const onRemove = vi.fn();
    await render({ onRemove });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.textAnimation.remove"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("disables controls while a source update is unavailable", async () => {
    await render({ disabled: true });

    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.textAnimation.remove"]',
      )?.disabled,
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });
});
