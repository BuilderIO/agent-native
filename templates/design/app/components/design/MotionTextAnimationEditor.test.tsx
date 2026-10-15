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

  async function selectOption(trigger: HTMLButtonElement, optionText: string) {
    await act(async () => trigger.click());
    const option = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent?.trim() === optionText);
    expect(option).toBeDefined();
    await act(async () => option!.click());
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
        '[aria-label="designEditor.motion.nativeTextStagger.animationDirection"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.motion.nativeTextStagger.order"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('input[id$="-overlap"]')).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
      ),
    ).toBeNull();
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

    const overlapInput = container.querySelector<HTMLInputElement>(
      'input[id$="-overlap"]',
    )!;
    await enterValue(overlapInput, "25");
    expect(onChange).toHaveBeenLastCalledWith([
      { ...opacityAnimation, staggerMs: 450, overlapPercent: 25 },
      { ...translateAnimation, staggerMs: 450, overlapPercent: 25 },
    ]);

    const delayInput = container.querySelector<HTMLInputElement>(
      'input[id$="-opacity-delay"]',
    )!;
    await enterValue(delayInput, "75");
    expect(onChange).toHaveBeenLastCalledWith([
      { ...opacityAnimation, delayMs: 75 },
      translateAnimation,
    ]);

    const durationInput = container.querySelector<HTMLInputElement>(
      'input[id$="-opacity-duration"]',
    )!;
    await enterValue(durationInput, "900");
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

  it("writes direction, order, and whitespace settings to every text track", async () => {
    const onChange = vi.fn();
    const characterAnimation = {
      ...opacityAnimation,
      unit: "character" as const,
    };
    await render({ animations: [characterAnimation], onChange });

    await selectOption(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="designEditor.motion.nativeTextStagger.animationDirection"]',
      )!,
      "designEditor.motion.nativeTextStagger.exit",
    );
    expect(onChange).toHaveBeenLastCalledWith([
      { ...characterAnimation, animationDirection: "out" },
    ]);

    await selectOption(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="designEditor.motion.nativeTextStagger.order"]',
      )!,
      "designEditor.motion.nativeTextStagger.orderOptions.centerOut",
    );
    expect(onChange).toHaveBeenLastCalledWith([
      { ...characterAnimation, order: "center-out", direction: "forward" },
    ]);

    const ignoreSpaces = container.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
    )!;
    await act(async () => ignoreSpaces.click());
    expect(onChange).toHaveBeenLastCalledWith([
      { ...characterAnimation, ignoreSpaces: false },
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
        animationDirection: "in",
        order: "left-to-right",
        ignoreSpaces: true,
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

  it("retains an explicit overlap value when adding a property track", async () => {
    const animation = { ...opacityAnimation, overlapPercent: 25 };
    const onChange = vi.fn();
    await render({ animations: [animation], onChange });

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.textAnimation.addPropertyTrack"]',
    )!;
    await act(async () =>
      addButton.dispatchEvent(
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
    await act(async () => translateMenuItem!.click());

    expect(onChange).toHaveBeenLastCalledWith([
      animation,
      expect.objectContaining({
        property: "translate",
        overlapPercent: 25,
      }),
    ]);
  });

  it.each(["character", "word", "line", "paragraph"] as const)(
    "offers only horizontal ordering for %s text",
    async (unit) => {
      await render({ animations: [{ ...opacityAnimation, unit }] });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="designEditor.motion.nativeTextStagger.order"]',
          )!
          .click(),
      );

      for (const order of [
        "leftToRight",
        "rightToLeft",
        "centerOut",
        "random",
      ]) {
        expect(document.body.textContent).toContain(
          `designEditor.motion.nativeTextStagger.orderOptions.${order}`,
        );
      }
      expect(document.body.textContent).not.toContain(
        "designEditor.motion.nativeTextStagger.orderOptions.topToBottom",
      );
      expect(document.body.textContent).not.toContain(
        "designEditor.motion.nativeTextStagger.orderOptions.bottomToTop",
      );
      await selectOption(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="designEditor.motion.nativeTextStagger.order"]',
        )!,
        "designEditor.motion.nativeTextStagger.orderOptions.leftToRight",
      );
    },
  );

  it("keeps a stored vertical order selectable without offering its alternative", async () => {
    await render({
      animations: [
        { ...opacityAnimation, unit: "line", order: "top-to-bottom" },
      ],
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="designEditor.motion.nativeTextStagger.order"]',
        )!
        .click(),
    );

    expect(document.body.textContent).toContain(
      "designEditor.motion.nativeTextStagger.orderOptions.topToBottom",
    );
    expect(document.body.textContent).not.toContain(
      "designEditor.motion.nativeTextStagger.orderOptions.bottomToTop",
    );
  });

  it.each(["word", "line", "paragraph"] as const)(
    "hides the ignore-spaces control for %s text",
    async (unit) => {
      await render({ animations: [{ ...opacityAnimation, unit }] });

      expect(
        container.querySelector(
          '[aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
        ),
      ).toBeNull();
    },
  );

  it("resets vertical order when text grouping changes to word", async () => {
    const onChange = vi.fn();
    await render({
      animations: [
        {
          ...opacityAnimation,
          unit: "line",
          order: "top-to-bottom",
        },
      ],
      onChange,
    });

    await selectOption(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="designEditor.motion.textAnimation.unit"]',
      )!,
      "designEditor.motion.textAnimation.units.word",
    );

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        unit: "word",
        order: "left-to-right",
        direction: "forward",
      }),
    ]);
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
