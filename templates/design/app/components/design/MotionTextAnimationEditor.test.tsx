// @vitest-environment happy-dom

import type { MotionTextAnimation } from "@shared/motion-text-code";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MotionTextAnimationEditor } from "./MotionTextAnimationEditor";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const opacityAnimation: MotionTextAnimation = {
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

const translateAnimation: MotionTextAnimation = {
  ...opacityAnimation,
  property: "translate",
  delayMs: 20,
  durationMs: 300,
  keyframes: [
    { t: 0, value: "0px", ease: "ease-out" },
    { t: 1, value: "12px" },
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
      animations: MotionTextAnimation[];
      onChange: (next: MotionTextAnimation[]) => void;
      disabled: boolean;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <MotionTextAnimationEditor
          animations={[opacityAnimation]}
          onChange={vi.fn()}
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

  it("renders shared text controls and per-property tracks", async () => {
    await render({ animations: [opacityAnimation, translateAnimation] });

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
    expect(container.textContent).toContain(
      "designEditor.motion.textAnimation.stagger",
    );
    expect(
      container.querySelectorAll(
        '[aria-label="designEditor.motion.textAnimation.property"]',
      ),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(
        'input[aria-label^="designEditor.motion.textAnimation.keyframeValue"]',
      ),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        'input[aria-label^="designEditor.motion.textAnimation.keyframeEase"]',
      ),
    ).toHaveLength(4);
  });

  it("applies shared edits to every track and keyframe edits to their track", async () => {
    const onChange = vi.fn();
    await render({
      animations: [opacityAnimation, translateAnimation],
      onChange,
    });

    const numberInputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    );
    await enterValue(numberInputs[0]!, "125");
    expect(onChange).toHaveBeenLastCalledWith([
      { ...opacityAnimation, staggerMs: 125 },
      { ...translateAnimation, staggerMs: 125 },
    ]);

    await enterValue(numberInputs[1]!, "900");
    expect(onChange).toHaveBeenLastCalledWith([
      { ...opacityAnimation, durationMs: 900 },
      translateAnimation,
    ]);

    await enterValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="designEditor.motion.textAnimation.keyframeValue 1.1"]',
      )!,
      "0.25",
    );
    expect(onChange).toHaveBeenLastCalledWith([
      {
        ...opacityAnimation,
        keyframes: [
          { t: 0, value: "0.25", ease: "ease-out" },
          opacityAnimation.keyframes[1],
        ],
      },
      translateAnimation,
    ]);

    await enterValue(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="designEditor.motion.textAnimation.keyframeEase 2.2"]',
      )!,
      "linear",
    );
    expect(onChange).toHaveBeenLastCalledWith([
      opacityAnimation,
      {
        ...translateAnimation,
        keyframes: [
          translateAnimation.keyframes[0],
          { t: 1, value: "12px", ease: "linear" },
        ],
      },
    ]);
  });

  it("adds unused property tracks and removes only the selected track", async () => {
    const onChange = vi.fn();
    await render({ onChange });

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.textAnimation.addPropertyTrack"]',
    );
    expect(addButton).not.toBeNull();
    await act(async () =>
      addButton!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    const translateMenuItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) =>
      item.textContent?.includes(
        "designEditor.motion.textAnimation.properties.translate",
      ),
    );
    expect(translateMenuItem).toBeDefined();
    await act(async () => {
      translateMenuItem!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      translateMenuItem!.click();
    });

    expect(onChange).toHaveBeenLastCalledWith([
      opacityAnimation,
      {
        ...opacityAnimation,
        property: "translate",
        delayMs: 0,
        keyframes: [
          { t: 0, value: "0px", ease: "ease-out" },
          { t: 1, value: "16px" },
        ],
      },
    ]);

    await render({
      animations: [opacityAnimation, translateAnimation],
      onChange,
    });
    const removeTranslateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.textAnimation.removePropertyTrack: designEditor.motion.textAnimation.properties.translate"]',
    );
    expect(removeTranslateButton).not.toBeNull();
    await act(async () => removeTranslateButton!.click());
    expect(onChange).toHaveBeenLastCalledWith([opacityAnimation]);
  });

  it("disables controls while a source update is unavailable", async () => {
    await render({
      animations: [opacityAnimation, translateAnimation],
      disabled: true,
    });

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
