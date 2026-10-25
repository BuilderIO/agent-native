// @vitest-environment happy-dom

import type { MotionEasingVariable } from "@shared/motion-easing";
import type { MotionNativeStyleInstance } from "@shared/motion-native-style";
import { createMotionNativeStyleInstance } from "@shared/motion-native-style-runtime";
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMotionNativeStyleIdentity,
  removeMotionNativeStyleAndReconcileSelection,
  resolveMotionNativeStyleIdentity,
  type MotionNativeStyleIdentity,
} from "./motion-native-style-identity";
import {
  MotionEasingPicker,
  MotionBezierCurveEditor,
  MotionNativeStyleEditor,
  easingPreviewPath,
  type MotionEasingPickerProps,
} from "./MotionNativeStyleEditor";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const positionStyle: MotionNativeStyleInstance = {
  type: "FIGMA",
  styleKey: "Position",
  sourceStyleId: "style-1",
  sourceInstanceId: "instance-1",
  nameKey: "motion.preset_name.position",
  duration: 0.5,
  timelineOffset: 0.2,
  targetNodeId: "target-1",
  props: {
    type: "slide_in",
    direction: "left",
    distance: 200,
    delay: 0.1,
    easing: { type: "EASE_OUT", customCurve: [0.2, 0.8] },
    futureProperty: { keep: true },
  },
};

describe("MotionNativeStyleEditor", () => {
  it.each([
    ["ease", "M 0 100 C 25 90, 25 0, 100 0"],
    ["ease-in", "M 0 100 C 42 100, 100 0, 100 0"],
    ["ease-out", "M 0 100 C 0 100, 58 0, 100 0"],
    ["ease-in-out", "M 0 100 C 42 100, 58 0, 100 0"],
  ])(
    "renders the CSS %s curve without rewriting its source value",
    async (ease, path) => {
      const onChange = vi.fn();
      await act(async () => {
        root.render(
          <MotionBezierCurveEditor
            value={ease}
            disabled={false}
            onChange={onChange}
            t={(key) => key}
          />,
        );
      });

      const preview = container.querySelector<SVGSVGElement>(
        "svg[data-easing-curve]",
      );
      expect(preview?.dataset.easingCurve).toBe(ease);
      expect(
        preview?.querySelector("path[data-curve-path]")?.getAttribute("d"),
      ).toBe(path);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["step-start", "M 0 100 V 0 H 100"],
    ["step-end", "M 0 100 H 100 V 0"],
    ["steps(2, end)", "M 0 100 H 50 V 50 H 100 V 0"],
    ["steps(2, start)", "M 0 50 H 50 V 0 H 100"],
    ["steps(2, jump-none)", "M 0 100 H 50 V 0 H 100"],
  ])(
    "renders the CSS %s timing function as a step graph",
    async (ease, path) => {
      await act(async () => {
        root.render(
          <MotionBezierCurveEditor
            value={ease}
            disabled={false}
            onChange={vi.fn()}
            t={(key) => key}
          />,
        );
      });

      const preview = container.querySelector<SVGSVGElement>(
        "svg[data-easing-curve]",
      );
      expect(preview?.dataset.easingCurve).toBe(ease);
      expect(
        preview?.querySelector("path[data-curve-path]")?.getAttribute("d"),
      ).toBe(path);
    },
  );

  it.each([
    ["step-end", "M1 14 H15 V2"],
    ["steps(2, end)", "M1 14 H8 V8 H15 V2"],
    ["steps(2, start)", "M1 8 H8 V2 H15"],
  ])(
    "maps the CSS %s step graph into compact preview coordinates",
    (ease, path) => {
      expect(easingPreviewPath(ease)).toBe(path);
    },
  );

  it("renders a piecewise CSS linear() curve without replacing the authored timing function", async () => {
    const ease = "linear(0, 0.25 25%, 1 100%)";
    await act(async () => {
      root.render(
        <MotionBezierCurveEditor
          value={ease}
          disabled={false}
          onChange={vi.fn()}
          t={(key) => key}
        />,
      );
    });

    const preview = container.querySelector<SVGSVGElement>(
      "svg[data-easing-curve]",
    );
    expect(preview?.dataset.easingCurve).toBe(ease);
    expect(
      preview?.querySelector("path[data-curve-path]")?.getAttribute("d"),
    ).toBe("M 0 100 L 25 75 L 100 0");
  });

  // oracle-change: CSS Easing Functions Level 2 §2.1.4 continues the nearest
  // segment outside the provided stop range: https://www.w3.org/TR/css-easing-2/#output-of-a-linear-easing-function
  it("extends CSS linear() stop previews along their nearest segments", async () => {
    await act(async () => {
      root.render(
        <MotionBezierCurveEditor
          value="linear(0 20%, 1 80%)"
          disabled={false}
          onChange={vi.fn()}
          t={(key) => key}
        />,
      );
    });

    expect(
      container
        .querySelector("svg[data-easing-curve] path[data-curve-path]")
        ?.getAttribute("d"),
    ).toBe("M 0 133.33 L 20 100 L 80 0 L 100 -33.33");
  });

  // oracle-change: CSS Easing Functions Level 2 §2.1.4 resolves equal stop
  // inputs to point B: https://www.w3.org/TR/css-easing-2/#output-of-a-linear-easing-function
  it("clamps descending CSS linear() stop positions to the preceding stop", async () => {
    await act(async () => {
      root.render(
        <MotionBezierCurveEditor
          value="linear(0 80%, 1 20%)"
          disabled={false}
          onChange={vi.fn()}
          t={(key) => key}
        />,
      );
    });

    expect(
      container
        .querySelector("svg[data-easing-curve] path[data-curve-path]")
        ?.getAttribute("d"),
    ).toBe("M 0 0 L 80 0 L 100 0");
  });

  // oracle-change: CSS Easing Functions Level 2 §2.1.4 selects the last point
  // at an equal input, so intermediate points in a run are not outputs:
  // https://www.w3.org/TR/css-easing-2/#output-of-a-linear-easing-function
  it("draws only the output limits for CSS linear() stops at equal positions", async () => {
    await act(async () => {
      root.render(
        <MotionBezierCurveEditor
          value="linear(0, 0.4 50%, 0.9 50%, 0.6 50%, 1)"
          disabled={false}
          onChange={vi.fn()}
          t={(key) => key}
        />,
      );
    });

    expect(
      container
        .querySelector("svg[data-easing-curve] path[data-curve-path]")
        ?.getAttribute("d"),
    ).toBe("M 0 100 L 50 60 L 50 40 L 100 0");
  });

  // oracle-change: CSS Easing Functions Level 2 §2.1.4 selects the second
  // point when the first two inputs are equal, including for left extrapolation:
  // https://www.w3.org/TR/css-easing-2/#output-of-a-linear-easing-function
  it("uses the second output when the first CSS linear() stops share a positive position", async () => {
    await act(async () => {
      root.render(
        <MotionBezierCurveEditor
          value="linear(0 20%, 0.4 20%, 1)"
          disabled={false}
          onChange={vi.fn()}
          t={(key) => key}
        />,
      );
    });

    expect(
      container
        .querySelector("svg[data-easing-curve] path[data-curve-path]")
        ?.getAttribute("d"),
    ).toBe("M 0 60 L 20 60 L 100 0");
  });

  it.each(["steps(1, jump-none)", "steps(129, end)"])(
    "does not draw invalid or unsupported CSS step counts: %s",
    async (ease) => {
      await act(async () => {
        root.render(
          <MotionBezierCurveEditor
            value={ease}
            disabled={false}
            onChange={vi.fn()}
            t={(key) => key}
          />,
        );
      });

      expect(container.querySelector("svg[data-easing-curve]")).toBeNull();
    },
  );

  it("resolves source-identified styles after the list shifts", () => {
    const styles = [
      { ...positionStyle, sourceInstanceId: "first" },
      { ...positionStyle, sourceInstanceId: "selected" },
      { ...positionStyle, sourceInstanceId: "last" },
    ];
    const selection = createMotionNativeStyleIdentity(styles[1]!, 1);
    const currentStyles = [styles[1]!, styles[2]!];

    expect(
      resolveMotionNativeStyleIdentity(currentStyles, "target-1", selection),
    ).toEqual(createMotionNativeStyleIdentity(styles[1]!, 0));
  });

  it("keeps a stale selection on its original target when the canvas target changes", () => {
    const staleSelection = {
      ...createMotionNativeStyleIdentity(
        { ...positionStyle, sourceInstanceId: undefined },
        0,
      ),
      index: 0,
    };
    const currentStyles = [
      {
        ...positionStyle,
        sourceInstanceId: undefined,
        targetNodeId: "target-2",
      },
      {
        ...positionStyle,
        sourceInstanceId: undefined,
        styleKey: "Rotation" as const,
        targetNodeId: "target-1",
      },
      { ...positionStyle, sourceInstanceId: undefined },
    ];

    expect(
      resolveMotionNativeStyleIdentity(
        currentStyles,
        "target-2",
        staleSelection,
      ),
    ).toEqual(createMotionNativeStyleIdentity(currentStyles[2]!, 2));
  });

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
      styles: MotionNativeStyleInstance[];
      targetNodeId: string;
      isText: boolean;
      disabled: boolean;
      onChange: (
        instance: MotionNativeStyleInstance,
        identity: { key: string; index: number },
      ) => void;
      onRemove: (identity: {
        key: string;
        styleKey: MotionNativeStyleInstance["styleKey"];
        targetNodeId: string;
        index: number;
        sourceInstanceId?: string;
      }) => void;
      easingVariables: MotionEasingVariable[];
      onEasingVariablesChange: (variables: MotionEasingVariable[]) => void;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <MotionNativeStyleEditor
          styles={[positionStyle]}
          targetNodeId="target-1"
          onChange={vi.fn()}
          onRemove={vi.fn()}
          t={(key) => key}
          {...overrides}
        />,
      );
    });
  }

  async function renderPicker(
    overrides: Partial<MotionEasingPickerProps> = {},
  ) {
    await act(async () => {
      root.render(
        <MotionEasingPicker
          value="cubic-bezier(0, 0, 0.58, 1)"
          easingVariables={[]}
          onChange={vi.fn()}
          onEasingVariablesChange={vi.fn()}
          disabled={false}
          t={(key) => key}
          {...overrides}
        />,
      );
    });
  }

  async function openStyleDetails() {
    const row = container.querySelector<HTMLButtonElement>(
      'li > button[aria-pressed="true"]',
    )!;
    await act(async () => row.click());
  }

  const controlsKey = "designEditor.motion.textStaggerControls";
  const settingsToggle = () =>
    document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${controlsKey}.settings"]`,
    );

  async function openTextSettings() {
    const toggle = settingsToggle();
    if (!toggle) throw new Error("Missing text stagger settings toggle");
    await act(async () => toggle.click());
  }

  function effectButton(
    action: "showDetails" | "hideDetails" | "removeEffect",
    effect: "move" | "growShrink" | "spin" | "fade" | "soften",
  ) {
    return document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${controlsKey}.${action} ${controlsKey}.effectNames.${effect}"]`,
    );
  }

  function effectVisibilityButton(
    action: "hide" | "show",
    effect: "move" | "growShrink" | "spin" | "fade" | "soften",
  ) {
    return document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="designEditor.motion.animationStyles.${action} ${controlsKey}.effectNames.${effect}"]`,
    );
  }

  async function openAddEffectMenu() {
    const trigger = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${controlsKey}.addEffect"]`,
    );
    if (!trigger) throw new Error("Missing add effect button");
    await act(async () =>
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
  }

  async function selectAddableEffect(
    effect: "move" | "growShrink" | "spin" | "fade" | "soften",
  ) {
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find(
      (candidate) =>
        candidate.textContent?.trim() ===
        `${controlsKey}.effectNames.${effect}`,
    );
    if (!item) throw new Error(`Missing add effect item ${effect}`);
    await act(async () => item.click());
  }

  async function renderTextStagger(
    props: MotionNativeStyleInstance["props"] = {},
    onChange: (
      instance: MotionNativeStyleInstance,
      identity: { key: string; index: number },
    ) => void = vi.fn(),
  ) {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    await render({
      styles: [{ ...base, props: { ...base.props, ...props } }],
      onChange,
    });
    await openStyleDetails();
    return onChange;
  }

  async function openCurveEditor() {
    const button = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.showEasingCurveEditor"]',
    );
    if (!button) throw new Error("Missing easing curve editor button");
    await act(async () => button.click());
  }

  async function selectOption(trigger: HTMLButtonElement, optionText: string) {
    await act(async () => trigger.click());
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent?.trim() === optionText);
    if (!option) throw new Error(`Missing select option ${optionText}`);
    await act(async () => option.click());
    await vi.waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
  }

  async function clickButtonWithText(text: string) {
    const button = await vi.waitFor(() => {
      const found = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent?.trim() === text);
      if (!found) throw new Error(`Missing button ${text}`);
      return found;
    });
    await act(async () => button.click());
  }

  async function clickButtonWithLabel(label: string) {
    const button = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`Missing button with label ${label}`);
    await act(async () => button.click());
  }

  async function focusButtonWithText(text: string) {
    const button = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === text);
    if (!button) throw new Error(`Missing button ${text}`);
    await act(async () => button.focus());
  }

  async function setInputValue(input: HTMLInputElement, value: string) {
    await act(async () => {
      const valueDescriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      if (typeof valueDescriptor?.set !== "function") {
        throw new Error("Missing native input value setter");
      }
      valueDescriptor.set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function dispatchPointer(
    target: Element,
    type: "pointerdown" | "pointermove" | "pointerup",
    clientX: number,
    clientY: number,
  ) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
      clientX: { value: clientX },
      clientY: { value: clientY },
      pointerId: { value: 7 },
    });
    await act(async () => target.dispatchEvent(event));
  }

  function setGraphBounds(svg: SVGSVGElement, width = 100, height = 100) {
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 0,
          top: 0,
          width,
          height,
          right: width,
          bottom: height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => null,
    });
  }

  async function openEasingPicker(
    label = "designEditor.motion.animationStyles.easingPresets.easeOut",
  ) {
    const trigger = document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!trigger) throw new Error("Missing easing picker trigger");
    await act(async () => trigger.click());
    await vi.waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });
  }

  // oracle-change: CSS Easing Functions Level 2 §2.1.4 continues the nearest
  // segment outside the provided stop range: https://www.w3.org/TR/css-easing-2/#output-of-a-linear-easing-function
  it("renders a valid compact path for a selected CSS linear() easing", async () => {
    await renderPicker({ value: "linear(0 20%, 1 80%)" });
    await openEasingPicker("designEditor.motion.customBezier");

    const preview = document.body.querySelector<SVGSVGElement>(
      'svg[data-motion-easing-preview="custom-bezier"]',
    );
    expect(preview?.querySelector("path")?.getAttribute("d")).toBe(
      "M1 18 L3.8 14 L12.2 2 L15 -2",
    );
    expect(preview?.querySelector("path")?.getAttribute("d")).not.toMatch(
      /\bL\s+L\b/,
    );
  });

  it("preserves a selected CSS linear() easing when activating its custom preset", async () => {
    const value = "linear(0 20%, 1 80%)";
    const onChange = vi.fn();
    await renderPicker({ value, onChange });
    await openEasingPicker("designEditor.motion.customBezier");

    const customOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.customBezier"]',
      ),
    ).find((button) =>
      button.querySelector('svg[data-motion-easing-preview="custom-bezier"]'),
    );
    if (!customOption) throw new Error("Missing custom easing option");
    await act(async () => customOption.click());

    expect(onChange).toHaveBeenCalledWith(value);
  });

  it("orders easing presets with Hold first", async () => {
    await renderPicker();
    await openEasingPicker();

    expect(
      document.body.querySelector(
        'input[aria-label="designEditor.motion.animationStyles.easingPicker.searchPlaceholder"]',
      ),
    ).toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.animationStyles.easingPicker.newVariable"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.animationStyles.close"]',
      ),
    ).not.toBeNull();

    const presetLabels = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ).map((button) => button.textContent?.trim());
    expect(presetLabels).toEqual([
      "designEditor.motion.animationStyles.easingPresets.hold",
      "designEditor.motion.animationStyles.easingPresets.linear",
      "designEditor.motion.animationStyles.easingPresets.easeIn",
      "designEditor.motion.animationStyles.easingPresets.easeOut",
      "designEditor.motion.animationStyles.easingPresets.easeInOut",
      "designEditor.motion.animationStyles.easingPresets.easeInBack",
      "designEditor.motion.animationStyles.easingPresets.easeOutBack",
      "designEditor.motion.animationStyles.easingPresets.easeInOutBack",
      "designEditor.motion.customBezier",
      "designEditor.motion.animationStyles.easingPresets.gentle",
      "designEditor.motion.animationStyles.easingPresets.quick",
      "designEditor.motion.animationStyles.easingPresets.bouncy",
      "designEditor.motion.animationStyles.easingPresets.slow",
      "designEditor.motion.customSpring",
    ]);
  });

  it("shows miniature curves and the selected state for each curve preset", async () => {
    await renderPicker({
      mode: "curve",
      value: "cubic-bezier(0.42, 0, 1, 1)",
    });
    await openEasingPicker(
      "designEditor.motion.animationStyles.easingPresets.easeIn",
    );

    const previews = Array.from(
      document.body.querySelectorAll<SVGSVGElement>(
        "[data-motion-easing-preview]",
      ),
    );
    expect(previews).toHaveLength(9);
    expect(
      previews.every((preview) =>
        /^M/.test(preview.querySelector("path")?.getAttribute("d") ?? ""),
      ),
    ).toBe(true);
    expect(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeIn"][aria-pressed]',
      )?.className,
    ).toContain("bg-[var(--design-editor-selection-color)]");
  });

  it("renders spring preset curves in the spring-only picker", async () => {
    await renderPicker({ mode: "spring", value: "spring(0.4)" });
    await openEasingPicker("designEditor.motion.customSpring");

    expect(
      document.body.querySelectorAll("[data-motion-easing-preview]"),
    ).toHaveLength(5);
    expect(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.customSpring"][aria-pressed]',
      )?.className,
    ).toContain("bg-[var(--design-editor-selection-color)]");
  });

  it("renders a selected style row and localized source-backed controls", async () => {
    await render();
    await openStyleDetails();

    expect(document.body.textContent).toContain(
      "designEditor.motion.animationStyles.position",
    );
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '[aria-label="designEditor.motion.textAnimation.direction"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeOut"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.animationStyles.showEasingCurveEditor"]',
      ),
    ).not.toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>("li > button")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    const typeSelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.type"]',
    )!;
    await act(async () => typeSelect.click());
    const typeOptions = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(typeOptions.map((option) => option.textContent?.trim())).toEqual([
      "designEditor.motion.animationStyles.slideIn",
      "designEditor.motion.animationStyles.slideOut",
      "designEditor.motion.animationStyles.custom",
    ]);
    await act(async () => typeOptions[0]?.click());

    const directionSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.motion.textAnimation.direction"]',
    )!;
    await act(async () => directionSelect.click());
    const directionOptions = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(
      directionOptions.map((option) => option.textContent?.trim()),
    ).toEqual([
      "designEditor.motion.animationStyles.fromLeft",
      "designEditor.motion.animationStyles.fromRight",
      "designEditor.motion.animationStyles.fromTop",
      "designEditor.motion.animationStyles.fromBottom",
      "designEditor.motion.animationStyles.fromTopLeft",
      "designEditor.motion.animationStyles.fromTopRight",
      "designEditor.motion.animationStyles.fromBottomLeft",
      "designEditor.motion.animationStyles.fromBottomRight",
    ]);
    await act(async () => directionOptions[0]?.click());

    await render({
      styles: [
        {
          ...positionStyle,
          props: { ...positionStyle.props, type: "slide_out" },
        },
      ],
    });
    const slideOutDirectionSelect =
      document.body.querySelector<HTMLButtonElement>(
        '[aria-label="designEditor.motion.textAnimation.direction"]',
      )!;
    await act(async () => slideOutDirectionSelect.click());
    const slideOutDirections = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(
      slideOutDirections.map((option) => option.textContent?.trim()),
    ).toEqual([
      "designEditor.motion.animationStyles.toLeft",
      "designEditor.motion.animationStyles.toRight",
      "designEditor.motion.animationStyles.toTop",
      "designEditor.motion.animationStyles.toBottom",
      "designEditor.motion.animationStyles.toTopLeft",
      "designEditor.motion.animationStyles.toTopRight",
      "designEditor.motion.animationStyles.toBottomLeft",
      "designEditor.motion.animationStyles.toBottomRight",
    ]);

    const curveToggle = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.showEasingCurveEditor"]',
    )!;
    expect(curveToggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => curveToggle.click());
    expect(curveToggle.getAttribute("aria-expanded")).toBe("true");
    const curvePanelId = curveToggle.getAttribute("aria-controls");
    expect(
      document.body.querySelector(`#${curvePanelId}`)?.hasAttribute("hidden"),
    ).toBe(false);
    const curveGroup = document.body.querySelector<SVGSVGElement>(
      '[role="group"][aria-label="designEditor.motion.animationStyles.curvePreview"]',
    );
    expect(
      curveGroup?.querySelectorAll('[data-curve-handle][role="button"]'),
    ).toHaveLength(2);
  });

  it("edits custom Size axes without discarding hidden dimensions", async () => {
    const sizeStyle = createMotionNativeStyleInstance({
      styleKey: "Size",
      targetNodeId: "target-1",
    });
    const values = {
      type: "custom",
      axis: "xy",
      startWidth: 61,
      endWidth: 117,
      startHeight: 72,
      endHeight: 128,
    } as const;
    const onChange = vi.fn();
    await render({
      styles: [{ ...sizeStyle, props: { ...sizeStyle.props, ...values } }],
      onChange,
    });

    async function ensureStyleDetails() {
      if (
        !document.body.querySelector(
          '[data-motion-native-style-settings="Size"]',
        )
      ) {
        await openStyleDetails();
      }
    }

    async function chooseAxis(axis: "Both" | "X" | "Y") {
      const trigger = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.animationStyles.axis"]',
      );
      if (!trigger) throw new Error("Missing Size axis selector");
      await act(async () => trigger.click());
      const option = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="option"]'),
      ).find(
        (candidate) =>
          candidate.textContent?.trim() ===
          `designEditor.motion.animationStyles.axis${axis}`,
      );
      if (!option) throw new Error(`Missing Size axis option ${axis}`);
      await act(async () => option.click());
    }

    function updatedStyle() {
      const latest = onChange.mock.lastCall?.[0];
      if (!latest) throw new Error("Size axis change was not saved");
      return latest as MotionNativeStyleInstance;
    }

    function dimensionInput(label: string) {
      return document.body.querySelector<HTMLInputElement>(
        `input[aria-label="designEditor.motion.animationStyles.${label}"]`,
      );
    }

    await ensureStyleDetails();
    expect(dimensionInput("startWidth")?.value).toBe("61");
    expect(dimensionInput("endWidth")?.value).toBe("117");
    expect(dimensionInput("startHeight")?.value).toBe("72");
    expect(dimensionInput("endHeight")?.value).toBe("128");

    await chooseAxis("X");
    const xStyle = updatedStyle();
    expect(xStyle.props).toMatchObject({ ...values, axis: "x" });
    await render({ styles: [xStyle], onChange });
    await ensureStyleDetails();
    expect(dimensionInput("startWidth")?.value).toBe("61");
    expect(dimensionInput("endWidth")?.value).toBe("117");
    expect(dimensionInput("startHeight")).toBeNull();
    expect(dimensionInput("endHeight")).toBeNull();

    await chooseAxis("Y");
    const yStyle = updatedStyle();
    expect(yStyle.props).toMatchObject({ ...values, axis: "y" });
    await render({ styles: [yStyle], onChange });
    await ensureStyleDetails();
    expect(dimensionInput("startWidth")).toBeNull();
    expect(dimensionInput("endWidth")).toBeNull();
    expect(dimensionInput("startHeight")?.value).toBe("72");
    expect(dimensionInput("endHeight")?.value).toBe("128");

    await chooseAxis("Both");
    expect(updatedStyle().props).toMatchObject(values);
  });

  it("syncs selection from either pane and keeps a closed style popover closed", async () => {
    const scaleStyle = createMotionNativeStyleInstance({
      styleKey: "Scale",
      targetNodeId: "target-1",
    });
    const scaleIdentity = createMotionNativeStyleIdentity(scaleStyle, 1);
    const styles = [positionStyle, scaleStyle];

    function SelectionHarness() {
      const [selectedStyle, setSelectedStyle] =
        useState<MotionNativeStyleIdentity | null>(null);
      const [, setRevision] = useState(0);

      return (
        <>
          <button
            type="button"
            data-motion-select-native-style
            data-test-select-scale
            onClick={() => setSelectedStyle(scaleIdentity)}
          >
            Select Scale from timeline
          </button>
          <button
            type="button"
            data-test-rerender
            onClick={() => setRevision((revision) => revision + 1)}
          >
            Rerender
          </button>
          <MotionNativeStyleEditor
            styles={styles}
            targetNodeId="target-1"
            selectedStyle={selectedStyle ? { ...selectedStyle } : null}
            onSelectedStyleChange={setSelectedStyle}
            onChange={vi.fn()}
            onRemove={vi.fn()}
            t={(key) => key}
          />
        </>
      );
    }

    await act(async () => root.render(<SelectionHarness />));

    const styleRow = (label: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>("li > button"),
      ).find((button) => button.textContent?.trim() === label);
    const selectScaleFromTimeline = container.querySelector<HTMLButtonElement>(
      "[data-test-select-scale]",
    )!;
    const positionRow = styleRow(
      "designEditor.motion.animationStyles.position",
    )!;
    const scaleRow = styleRow("designEditor.motion.animationStyles.scale")!;
    await act(async () => positionRow.click());
    expect(positionRow.getAttribute("aria-pressed")).toBe("true");
    expect(scaleRow.getAttribute("aria-pressed")).toBe("false");
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).not.toBeNull();

    await act(async () => scaleRow.click());
    expect(scaleRow.getAttribute("aria-pressed")).toBe("true");
    expect(positionRow.getAttribute("aria-pressed")).toBe("false");
    expect(
      document.body.querySelector(
        '[data-motion-native-style-settings="Scale"][data-state="open"]',
      ),
    ).not.toBeNull();

    await act(async () => positionRow.click());
    expect(positionRow.getAttribute("aria-pressed")).toBe("true");
    expect(
      document.body.querySelector(
        '[data-motion-native-style-settings="Position"][data-state="open"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      selectScaleFromTimeline.focus();
      selectScaleFromTimeline.click();
    });
    expect(scaleRow.getAttribute("aria-pressed")).toBe("true");
    expect(
      styleRow("designEditor.motion.animationStyles.position")?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).toBeNull();

    await act(async () =>
      styleRow("designEditor.motion.animationStyles.scale")!.click(),
    );
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).not.toBeNull();
    await act(async () =>
      styleRow("designEditor.motion.animationStyles.scale")!.click(),
    );
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-test-rerender]")!
        .click(),
    );
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).toBeNull();
  });

  it("reconciles a removed or previous-target selection to the current styles", async () => {
    const styles = [
      createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "target-1",
      }),
      createMotionNativeStyleInstance({
        styleKey: "Scale",
        targetNodeId: "target-1",
      }),
      createMotionNativeStyleInstance({
        styleKey: "Rotation",
        targetNodeId: "target-2",
      }),
      createMotionNativeStyleInstance({
        styleKey: "Opacity",
        targetNodeId: "target-2",
      }),
    ];
    const initialSelection = createMotionNativeStyleIdentity(styles[0]!, 0);

    function ReconciliationHarness() {
      const [currentStyles, setStyles] = useState(styles);
      const [targetNodeId, setTargetNodeId] = useState("target-1");
      const [selectedStyle, setSelectedStyle] =
        useState<MotionNativeStyleIdentity | null>(initialSelection);
      const previousTargetNodeIdRef = useRef(targetNodeId);
      useEffect(() => {
        const targetChanged = previousTargetNodeIdRef.current !== targetNodeId;
        previousTargetNodeIdRef.current = targetNodeId;
        const resolvedSelection = resolveMotionNativeStyleIdentity(
          currentStyles,
          targetNodeId,
          targetChanged ? null : selectedStyle,
        );
        if (
          resolvedSelection?.key === selectedStyle?.key &&
          resolvedSelection?.sourceInstanceId ===
            selectedStyle?.sourceInstanceId
        ) {
          return;
        }
        setSelectedStyle(resolvedSelection);
      }, [currentStyles, selectedStyle, targetNodeId]);

      return (
        <>
          <button
            type="button"
            data-test-switch-target
            onClick={() => setTargetNodeId("target-2")}
          >
            Switch target
          </button>
          <button
            type="button"
            data-test-remove-selected-style
            onClick={() => {
              if (!selectedStyle) return;
              setStyles((current) =>
                current.filter((_, index) => index !== selectedStyle.index),
              );
            }}
          >
            Remove selected style
          </button>
          <output data-test-selected-style>
            {selectedStyle
              ? `${selectedStyle.targetNodeId}:${selectedStyle.styleKey}`
              : "none"}
          </output>
          <MotionNativeStyleEditor
            styles={currentStyles}
            targetNodeId={targetNodeId}
            selectedStyle={selectedStyle}
            onSelectedStyleChange={setSelectedStyle}
            onChange={vi.fn()}
            onRemove={vi.fn()}
            t={(key) => key}
          />
        </>
      );
    }

    await act(async () => root.render(<ReconciliationHarness />));
    const selection = () =>
      container.querySelector("[data-test-selected-style]")?.textContent;
    const styleRow = (label: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>("li > button"),
      ).find((button) => button.textContent?.trim() === label);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-test-switch-target]")!
        .click(),
    );
    expect(selection()).toBe("target-2:Opacity");
    expect(
      styleRow("designEditor.motion.animationStyles.opacity")?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      document.body.querySelector(
        '[data-motion-native-style-settings="Opacity"]',
      ),
    ).toBeNull();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-test-remove-selected-style]")!
        .click(),
    );
    expect(selection()).toBe("target-2:Rotation");
    expect(
      styleRow("designEditor.motion.animationStyles.rotation")?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-test-remove-selected-style]")!
        .click(),
    );
    expect(selection()).toBe("none");
    expect(
      document.body.querySelector(
        '[data-motion-native-style-settings="Rotation"]',
      ),
    ).toBeNull();
  });

  it("keeps the selected inspector style when an earlier same-type row is removed", async () => {
    const styles = [
      {
        ...positionStyle,
        sourceInstanceId: undefined,
        props: { ...positionStyle.props, distance: 10 },
      },
      {
        ...positionStyle,
        sourceInstanceId: undefined,
        props: { ...positionStyle.props, distance: 20 },
      },
      {
        ...positionStyle,
        sourceInstanceId: undefined,
        props: { ...positionStyle.props, distance: 30 },
      },
    ];

    function RemovalHarness() {
      const [currentStyles, setStyles] =
        useState<MotionNativeStyleInstance[]>(styles);
      const [selectedStyle, setSelectedStyle] =
        useState<MotionNativeStyleIdentity | null>(
          createMotionNativeStyleIdentity(styles[1]!, 1),
        );
      const selectedDistance =
        currentStyles[selectedStyle?.index ?? -1]?.props.distance ?? "none";
      const renderedDistance =
        typeof selectedDistance === "object"
          ? (JSON.stringify(selectedDistance) ?? "none")
          : String(selectedDistance);

      return (
        <>
          <output data-test-selected-distance>{renderedDistance}</output>
          <MotionNativeStyleEditor
            styles={currentStyles}
            targetNodeId="target-1"
            selectedStyle={selectedStyle}
            onSelectedStyleChange={setSelectedStyle}
            onChange={vi.fn()}
            onRemove={(identity) => {
              const result = removeMotionNativeStyleAndReconcileSelection(
                currentStyles,
                selectedStyle,
                identity,
                "target-1",
              );
              setStyles(result.styles);
              setSelectedStyle(result.selection);
            }}
            t={(key) => key}
          />
        </>
      );
    }

    await act(async () => root.render(<RemovalHarness />));
    const positionRows = Array.from(
      container.querySelectorAll<HTMLElement>("li"),
    );
    await act(async () => {
      positionRows[0]!
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="designEditor.motion.animationStyles.removeAnimation"]',
        )!
        .click();
    });

    expect(
      container.querySelector("[data-test-selected-distance]")?.textContent,
    ).toBe("20");
    expect(
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          "button[data-motion-native-style-trigger]",
        ),
      ).map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["true", "false"]);
  });

  it("edits native TextStagger controls without discarding source props", async () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    const style = {
      ...base,
      sourceInstanceId: "native-text-instance",
      props: { ...base.props, futureTextProp: { keep: true } },
    };
    const onChange = vi.fn();
    await render({ styles: [style], onChange });
    await openStyleDetails();

    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.nativeTextStagger.animationDirection"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.nativeTextStagger.grouping"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '[role="checkbox"][aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
      ),
    ).toBeNull();
    await openTextSettings();
    const ignoreSpaces = document.body.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
    );
    expect(ignoreSpaces?.getAttribute("aria-checked")).toBe("false");

    const removeMove = effectButton("removeEffect", "move");
    expect(removeMove).not.toBeNull();
    await act(async () => removeMove!.click());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceInstanceId: "native-text-instance",
        props: expect.objectContaining({
          positionEnabled: false,
          futureTextProp: { keep: true },
        }),
      }),
      expect.objectContaining({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
        index: 0,
      }),
    );

    const groupingTrigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.nativeTextStagger.grouping"]',
    )!;
    await selectOption(
      groupingTrigger,
      "designEditor.motion.textAnimation.units.word",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceInstanceId: "native-text-instance",
        props: expect.objectContaining({
          textDelayGrouping: "WORD",
          futureTextProp: { keep: true },
        }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );

    await act(async () => ignoreSpaces!.click());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceInstanceId: "native-text-instance",
        props: expect.objectContaining({ ignoreSpaces: true }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );

    const orderTrigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.nativeTextStagger.order"]',
    )!;
    await selectOption(
      orderTrigger,
      "designEditor.motion.nativeTextStagger.orderOptions.random",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceInstanceId: "native-text-instance",
        props: expect.objectContaining({ textDelayOrder: "RANDOM" }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );
  });

  describe("TextStagger settings", () => {
    const overlapThumb = () =>
      document.body.querySelector<HTMLElement>(
        '[role="slider"][aria-label="designEditor.motion.nativeTextStagger.overlap"]',
      );

    it("keeps the settings group closed until the toggle opens it", async () => {
      await renderTextStagger();

      expect(settingsToggle()?.getAttribute("aria-expanded")).toBe("false");
      expect(
        document.body.querySelector(
          'button[aria-label="designEditor.motion.nativeTextStagger.order"]',
        ),
      ).toBeNull();
      expect(overlapThumb()).toBeNull();

      await openTextSettings();
      expect(settingsToggle()?.getAttribute("aria-expanded")).toBe("true");
      expect(
        document.body.querySelector(
          'button[aria-label="designEditor.motion.nativeTextStagger.order"]',
        ),
      ).not.toBeNull();
      expect(overlapThumb()).not.toBeNull();
      expect(
        document.body.querySelector(
          '[role="checkbox"][aria-label="designEditor.motion.textStaggerControls.crop"]',
        ),
      ).not.toBeNull();
      expect(
        document.body.querySelectorAll(
          '[role="radio"][aria-label^="editPanel"]',
        ),
      ).toHaveLength(9);

      await openTextSettings();
      expect(overlapThumb()).toBeNull();
    });

    it("edits overlap with a slider that never leaves 0 to 100", async () => {
      const onChange = await renderTextStagger();
      await openTextSettings();
      expect(
        document.body.querySelector('input[type="number"][min="0"][max="100"]'),
      ).toBeNull();
      expect(overlapThumb()?.getAttribute("aria-valuenow")).toBe("50");

      await act(async () =>
        overlapThumb()!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true }),
        ),
      );
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ presetStaggerOverlap: 100 }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
      await act(async () =>
        overlapThumb()!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
        ),
      );
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ presetStaggerOverlap: 0 }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    });

    it("shows a stored out-of-range overlap clamped to the slider range", async () => {
      await renderTextStagger({ presetStaggerOverlap: 150 });
      await openTextSettings();

      expect(overlapThumb()?.getAttribute("aria-valuenow")).toBe("100");
    });

    it("writes the crop toggle to the style", async () => {
      const onChange = await renderTextStagger();
      await openTextSettings();
      const crop = document.body.querySelector<HTMLButtonElement>(
        '[role="checkbox"][aria-label="designEditor.motion.textStaggerControls.crop"]',
      )!;
      expect(crop.getAttribute("aria-checked")).toBe("false");
      await act(async () => crop.click());

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ clipContent: true }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    });

    it("writes the chosen pivot anchor and marks the stored one", async () => {
      const onChange = await renderTextStagger({
        elementTransformOriginX: 100,
        elementTransformOriginY: 0,
      });
      await openTextSettings();
      const anchors = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
      );
      expect(
        anchors
          .find((anchor) => anchor.getAttribute("aria-checked") === "true")
          ?.getAttribute("aria-label"),
      ).toBe("editPanel.scale.topRight");

      await act(async () =>
        anchors
          .find(
            (anchor) =>
              anchor.getAttribute("aria-label") ===
              "editPanel.scale.bottomLeft",
          )!
          .click(),
      );
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            elementTransformOriginX: 0,
            elementTransformOriginY: 100,
          }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    });
  });

  describe("TextStagger effects", () => {
    const addableEffects = () =>
      Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).map((item) => item.textContent?.trim());

    it("starts with move as the only added effect, collapsed", async () => {
      await renderTextStagger();

      expect(effectButton("showDetails", "move")).not.toBeNull();
      expect(
        effectButton("showDetails", "move")?.getAttribute("aria-expanded"),
      ).toBe("false");
      for (const effect of ["growShrink", "spin", "fade", "soften"] as const) {
        expect(effectButton("showDetails", effect)).toBeNull();
      }
      expect(
        document.body.querySelector(
          'button[aria-label="designEditor.motion.nativeTextStagger.positionDirection"]',
        ),
      ).toBeNull();
    });

    it("lists only effects not yet added and adds the chosen one", async () => {
      const onChange = await renderTextStagger();
      await openAddEffectMenu();
      expect(addableEffects()).toEqual([
        `${controlsKey}.effectNames.growShrink`,
        `${controlsKey}.effectNames.spin`,
        `${controlsKey}.effectNames.fade`,
        `${controlsKey}.effectNames.soften`,
      ]);
      await selectAddableEffect("spin");

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            rotationEnabled: true,
            rotationVisible: true,
          }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    });

    it("expands a newly added effect and offers it no more", async () => {
      let current = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
      });
      const onChange = vi.fn((next: MotionNativeStyleInstance) => {
        current = next;
      });
      await render({ styles: [current], onChange });
      await openStyleDetails();
      await openAddEffectMenu();
      await selectAddableEffect("fade");
      await render({ styles: [current], onChange });

      expect(
        effectButton("hideDetails", "fade")?.getAttribute("aria-expanded"),
      ).toBe("true");
      expect(effectButton("showDetails", "move")).not.toBeNull();
      expect(
        document.body.querySelector('input[type="number"][max="100"]'),
      ).not.toBeNull();
    });

    it("hides and shows an effect without removing it", async () => {
      const onChange = await renderTextStagger();
      await act(async () => effectVisibilityButton("hide", "move")!.click());

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            positionEnabled: true,
            positionVisible: false,
          }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );

      const base = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
      });
      await render({
        styles: [{ ...base, props: { ...base.props, positionVisible: false } }],
        onChange,
      });
      expect(effectVisibilityButton("hide", "move")).toBeNull();
      await act(async () => effectVisibilityButton("show", "move")!.click());
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ positionVisible: true }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    });

    it("removes an effect by disabling it", async () => {
      const onChange = await renderTextStagger({
        rotationEnabled: true,
        futureTextProp: { keep: true },
      });
      await act(async () => effectButton("removeEffect", "spin")!.click());

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            rotationEnabled: false,
            positionEnabled: true,
            futureTextProp: { keep: true },
          }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    });

    it("toggles an effect's details", async () => {
      await renderTextStagger();
      await act(async () => effectButton("showDetails", "move")!.click());

      expect(
        document.body.querySelector(
          'button[aria-label="designEditor.motion.nativeTextStagger.positionDirection"]',
        ),
      ).not.toBeNull();
      await act(async () => effectButton("hideDetails", "move")!.click());
      expect(
        document.body.querySelector(
          'button[aria-label="designEditor.motion.nativeTextStagger.positionDirection"]',
        ),
      ).toBeNull();
    });

    it.each([
      ["in", "fromTop", "toTop"],
      ["out", "toTop", "fromTop"],
    ] as const)(
      "labels the move direction for %s as %s",
      async (animationDirection, shown, hidden) => {
        await renderTextStagger({ animationDirection });
        await act(async () => effectButton("showDetails", "move")!.click());
        const trigger = document.body.querySelector<HTMLButtonElement>(
          'button[aria-label="designEditor.motion.nativeTextStagger.positionDirection"]',
        )!;

        expect(trigger.textContent).toBe(
          `designEditor.motion.animationStyles.${shown}`,
        );
        await act(async () => trigger.click());
        const options = Array.from(
          document.querySelectorAll<HTMLElement>('[role="option"]'),
        ).map((option) => option.textContent?.trim());
        expect(options).toContain(
          `designEditor.motion.animationStyles.${shown}`,
        );
        expect(options).not.toContain(
          `designEditor.motion.animationStyles.${hidden}`,
        );
      },
    );
  });

  it.each([true, false])(
    "offers the text style in the style switcher only for text layers (isText=%s)",
    async (isText) => {
      await render({ isText });
      await openStyleDetails();
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>(
            'button[aria-label="designEditor.motion.animationStyles.position"]',
          )!
          .click(),
      );
      const options = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]'),
      ).map((option) => option.textContent?.trim());

      expect(options.includes("designEditor.motion.animationStyles.text")).toBe(
        isText,
      );
      expect(options).toContain("designEditor.motion.animationStyles.scale");
    },
  );

  it("shows the legacy whitespace default for TextStagger styles", async () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    const {
      ignoreSpaces: _ignoreSpaces,
      textDelayTimingMode: _textDelayTimingMode,
      ...legacyProps
    } = base.props;
    const style = { ...base, props: legacyProps };
    const onChange = vi.fn();
    await render({ styles: [style], onChange });
    await openStyleDetails();
    await openTextSettings();

    const ignoreSpaces = document.body.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
    );
    expect(ignoreSpaces?.getAttribute("aria-checked")).toBe("true");
    await act(async () => ignoreSpaces!.click());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          ignoreSpaces: false,
          textDelayTimingMode: "fixed-stagger",
        }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );
  });

  it.each(["WORD", "LINE", "PARAGRAPH"] as const)(
    "hides Ignore spaces for %s TextStagger grouping",
    async (grouping) => {
      const base = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
      });
      await render({
        styles: [
          {
            ...base,
            props: { ...base.props, textDelayGrouping: grouping },
          },
        ],
      });
      await openStyleDetails();
      await openTextSettings();

      expect(
        document.body.querySelector(
          '[role="checkbox"][aria-label="designEditor.motion.nativeTextStagger.ignoreSpaces"]',
        ),
      ).toBeNull();
    },
  );

  it.each(["CHARACTER", "WORD", "LINE", "PARAGRAPH"] as const)(
    "offers only horizontal TextStagger order for %s grouping",
    async (grouping) => {
      const base = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
      });
      const style = {
        ...base,
        props: {
          ...base.props,
          textDelayGrouping: grouping,
          textDelayOrder: "LEFT_RIGHT",
        },
      };
      await render({ styles: [style] });
      await openStyleDetails();
      await openTextSettings();
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>(
            'button[aria-label="designEditor.motion.nativeTextStagger.order"]',
          )!
          .click(),
      );

      expect(document.body.textContent).not.toContain(
        "designEditor.motion.nativeTextStagger.orderOptions.topToBottom",
      );
      expect(document.body.textContent).not.toContain(
        "designEditor.motion.nativeTextStagger.orderOptions.bottomToTop",
      );
      await selectOption(
        document.querySelector<HTMLButtonElement>(
          'button[aria-label="designEditor.motion.nativeTextStagger.order"]',
        )!,
        "designEditor.motion.nativeTextStagger.orderOptions.leftToRight",
      );
    },
  );

  it.each(["CHARACTER", "WORD", "LINE", "PARAGRAPH"] as const)(
    "keeps a stored vertical TextStagger order selectable for %s grouping",
    async (grouping) => {
      const base = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
      });
      const style = {
        ...base,
        props: {
          ...base.props,
          textDelayGrouping: grouping,
          textDelayOrder: "TOP_BOTTOM",
        },
      };
      await render({ styles: [style] });
      await openStyleDetails();
      await openTextSettings();
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>(
            'button[aria-label="designEditor.motion.nativeTextStagger.order"]',
          )!
          .click(),
      );

      expect(document.body.textContent).toContain(
        "designEditor.motion.nativeTextStagger.orderOptions.topToBottom",
      );
      expect(document.body.textContent).not.toContain(
        "designEditor.motion.nativeTextStagger.orderOptions.bottomToTop",
      );
    },
  );

  it("resets vertical TextStagger order when grouping changes to word", async () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    const style = {
      ...base,
      props: {
        ...base.props,
        textDelayGrouping: "LINE",
        textDelayOrder: "TOP_BOTTOM",
      },
    };
    const onChange = vi.fn();
    await render({ styles: [style], onChange });
    await openStyleDetails();
    await selectOption(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.nativeTextStagger.grouping"]',
      )!,
      "designEditor.motion.textAnimation.units.word",
    );

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          textDelayGrouping: "WORD",
          textDelayOrder: "LEFT_RIGHT",
        }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );
  });

  it("clears Ignore spaces when TextStagger grouping changes", async () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    const style = {
      ...base,
      props: {
        ...base.props,
        ignoreSpaces: true,
      },
    };
    const onChange = vi.fn();
    await render({ styles: [style], onChange });
    await openStyleDetails();
    await selectOption(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.nativeTextStagger.grouping"]',
      )!,
      "designEditor.motion.textAnimation.units.word",
    );

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          textDelayGrouping: "WORD",
          ignoreSpaces: false,
        }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );
  });

  it.each([
    ["fixed-stagger", undefined],
    ["duration-fitted", false],
  ] as const)(
    "preserves marker-less %s timing when TextStagger grouping changes",
    async (timingMode, ignoreSpaces) => {
      const base = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "target-1",
      });
      const {
        ignoreSpaces: _ignoreSpaces,
        textDelayTimingMode: _textDelayTimingMode,
        ...legacyProps
      } = base.props;
      const style = {
        ...base,
        props: {
          ...legacyProps,
          ...(ignoreSpaces === undefined ? {} : { ignoreSpaces }),
        },
      };
      const onChange = vi.fn();
      await render({ styles: [style], onChange });
      await openStyleDetails();
      await selectOption(
        document.querySelector<HTMLButtonElement>(
          'button[aria-label="designEditor.motion.nativeTextStagger.grouping"]',
        )!,
        "designEditor.motion.textAnimation.units.word",
      );

      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            textDelayGrouping: "WORD",
            ignoreSpaces: false,
            textDelayTimingMode: timingMode,
          }),
        }),
        expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
      );
    },
  );

  it("keeps unknown native properties while editing known fields", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();

    const directionSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.motion.textAnimation.direction"]',
    )!;
    await selectOption(
      directionSelect,
      "designEditor.motion.animationStyles.fromTop",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: { ...positionStyle.props, direction: "top" },
      },
      {
        key: JSON.stringify(["Position", "target-1", 0]),
        styleKey: "Position",
        targetNodeId: "target-1",
        index: 0,
        sourceInstanceId: "instance-1",
      },
    );

    const styleNameSelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.type"]',
    )!;
    await selectOption(
      styleNameSelect,
      "designEditor.motion.animationStyles.slideOut",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: { ...positionStyle.props, type: "slide_out" },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );

    // Radix refocuses the Select trigger a macrotask after closing; a popover
    // opened before then reads that focus as outside and dismisses itself.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(styleNameSelect),
    );
    const easingSelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeOut"]',
    )!;
    await act(async () => easingSelect.click());
    await vi.waitFor(() => {
      expect(easingSelect.getAttribute("aria-expanded")).toBe("true");
    });
    await clickButtonWithLabel(
      "designEditor.motion.animationStyles.easingPresets.easeIn",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: {
          ...positionStyle.props,
          easing: "cubic-bezier(0.42, 0, 1, 1)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("orders easing choices across curve and spring controls", async () => {
    await render();
    await openStyleDetails();

    const easingSelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeOut"]',
    )!;
    await act(async () => easingSelect.click());

    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="tabpanel"][data-state="active"] button[aria-pressed]',
        ),
      )
        .map((option) => option.textContent?.trim())
        .filter(Boolean),
    ).toEqual([
      "designEditor.motion.animationStyles.easingPresets.hold",
      "designEditor.motion.animationStyles.easingPresets.linear",
      "designEditor.motion.animationStyles.easingPresets.easeIn",
      "designEditor.motion.animationStyles.easingPresets.easeOut",
      "designEditor.motion.animationStyles.easingPresets.easeInOut",
      "designEditor.motion.animationStyles.easingPresets.easeInBack",
      "designEditor.motion.animationStyles.easingPresets.easeOutBack",
      "designEditor.motion.animationStyles.easingPresets.easeInOutBack",
      "designEditor.motion.customBezier",
      "designEditor.motion.animationStyles.easingPresets.gentle",
      "designEditor.motion.animationStyles.easingPresets.quick",
      "designEditor.motion.animationStyles.easingPresets.bouncy",
      "designEditor.motion.animationStyles.easingPresets.slow",
      "designEditor.motion.customSpring",
    ]);
  });

  it("searches and filters easing libraries before selecting a variable", async () => {
    const variables: MotionEasingVariable[] = [
      {
        id: "ease-bounce",
        name: "Bounce easing",
        value: "spring(0.69)",
        collection: "Prototype",
      },
      {
        id: "ease-base",
        name: "Base easing",
        value: "cubic-bezier(0, 0, 0.58, 1)",
        collection: "Base",
      },
    ];
    const onChange = vi.fn();
    await renderPicker({ easingVariables: variables, onChange });
    await openEasingPicker();
    await focusButtonWithText(
      "designEditor.motion.animationStyles.easingPicker.libraries",
    );

    const searchInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.easingPicker.searchPlaceholder"]',
    )!;
    await setInputValue(searchInput, "bounce");
    expect(
      document.body.querySelector(
        'button[aria-label="Bounce easing, Prototype"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector('button[aria-label="Base easing, Base"]'),
    ).toBeNull();

    await setInputValue(searchInput, "");
    const filterTrigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.easingPicker.variableSet"]',
    )!;
    await selectOption(filterTrigger, "Base");
    expect(
      document.body.querySelector('button[aria-label="Base easing, Base"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="Bounce easing, Prototype"]',
      ),
    ).toBeNull();

    await clickButtonWithLabel("Base easing, Base");
    expect(onChange).toHaveBeenCalledWith("var(--an-motion-ease-ease-base)");
  });

  it("creates a curve variable in source metadata and selects its reference", async () => {
    const existingVariable: MotionEasingVariable = {
      id: "existing-easing",
      name: "Existing easing",
      value: "linear",
      collection: "Base",
    };
    const onChange = vi.fn();
    const onEasingVariablesChange = vi.fn();
    await renderPicker({
      easingVariables: [existingVariable],
      onChange,
      onEasingVariablesChange,
    });
    await openEasingPicker();
    await clickButtonWithLabel(
      "designEditor.motion.animationStyles.easingPicker.newVariable",
    );

    const collectionInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.easingVariable.collection"]',
    )!;
    const nameInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.easingVariable.name"]',
    )!;
    await setInputValue(collectionInput, "Motion");
    await setInputValue(nameInput, "Ease In");
    await clickButtonWithLabel("designEditor.motion.animationStyles.flipCurve");

    const bezierInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.bezier"]',
    )!;
    expect(bezierInput.value).toBe("0.42, 0, 1, 1");
    await clickButtonWithText(
      "designEditor.motion.animationStyles.easingVariable.create",
    );

    expect(onEasingVariablesChange).toHaveBeenCalledWith([
      existingVariable,
      {
        id: "ease-in",
        name: "Ease In",
        value: "cubic-bezier(0.42, 0, 1, 1)",
        collection: "Motion",
      },
    ]);
    expect(onChange).toHaveBeenCalledWith("var(--an-motion-ease-ease-in)");
  });

  it("creates a spring variable with the selected Bounce value", async () => {
    const onChange = vi.fn();
    const onEasingVariablesChange = vi.fn();
    await renderPicker({ onChange, onEasingVariablesChange });
    await openEasingPicker();
    await clickButtonWithLabel(
      "designEditor.motion.animationStyles.easingPicker.newVariable",
    );
    await focusButtonWithText("designEditor.motion.springTab");

    const nameInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.easingVariable.name"]',
    )!;
    await setInputValue(nameInput, "Soft Spring");
    const bounceLabel = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) =>
      label.textContent?.includes("designEditor.motion.bounce"),
    );
    const bounceInput = bounceLabel?.querySelector<HTMLInputElement>("input");
    if (!bounceInput) throw new Error("Missing spring Bounce input");
    await act(async () => bounceInput.focus());
    await setInputValue(bounceInput, "0.42");
    await act(async () => bounceInput.blur());
    await clickButtonWithText(
      "designEditor.motion.animationStyles.easingVariable.create",
    );

    expect(onEasingVariablesChange).toHaveBeenCalledWith([
      { id: "soft-spring", name: "Soft Spring", value: "spring(0.42)" },
    ]);
    expect(onChange).toHaveBeenCalledWith("var(--an-motion-ease-soft-spring)");
  });

  it("blocks a duplicate easing variable name in the same collection", async () => {
    const onEasingVariablesChange = vi.fn();
    await renderPicker({
      easingVariables: [
        {
          id: "ease-out",
          name: "Ease Out",
          value: "cubic-bezier(0, 0, 0.58, 1)",
          collection: "Motion",
        },
      ],
      onEasingVariablesChange,
    });
    await openEasingPicker();
    await clickButtonWithLabel(
      "designEditor.motion.animationStyles.easingPicker.newVariable",
    );

    const collectionInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.easingVariable.collection"]',
    )!;
    const nameInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.easingVariable.name"]',
    )!;
    await setInputValue(collectionInput, "Motion");
    await setInputValue(nameInput, "ease out");

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "designEditor.motion.animationStyles.easingVariable.duplicateName",
    );
    const createButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (button) =>
        button.textContent?.trim() ===
        "designEditor.motion.animationStyles.easingVariable.create",
    );
    expect(createButton?.disabled).toBe(true);
    expect(onEasingVariablesChange).not.toHaveBeenCalled();
  });

  it("previews the default ease-out curve and flips it to ease-in", async () => {
    const { easing: _easing, ...propsWithoutEasing } = positionStyle.props;
    const styleWithoutEasing = {
      ...positionStyle,
      props: propsWithoutEasing,
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithoutEasing], onChange });
    await openStyleDetails();
    await openCurveEditor();

    const preview = document.body.querySelector<SVGSVGElement>(
      'svg[aria-label="designEditor.motion.animationStyles.curvePreview"]',
    )!;
    expect(preview.dataset.easingCurve).toBe("cubic-bezier(0, 0, 0.58, 1)");
    expect(
      preview.querySelector("path[data-curve-path]")?.getAttribute("d"),
    ).toBe("M 0 100 C 0 100, 58 0, 100 0");

    const flipButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.flipCurve"]',
    )!;
    await act(async () => flipButton.click());
    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...styleWithoutEasing,
        props: {
          ...styleWithoutEasing.props,
          easing: "cubic-bezier(0.42, 0, 1, 1)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );

    const flippedStyle = {
      ...styleWithoutEasing,
      props: {
        ...styleWithoutEasing.props,
        easing: "cubic-bezier(0.42, 0, 1, 1)",
      },
    };
    await render({ styles: [flippedStyle], onChange });
    const flippedPreview = document.body.querySelector<SVGSVGElement>(
      'svg[aria-label="designEditor.motion.animationStyles.curvePreview"]',
    )!;
    expect(
      flippedPreview.querySelector("path[data-curve-path]")?.getAttribute("d"),
    ).toBe("M 0 100 C 42 100, 100 0, 100 0");
  });

  it("preserves the exact numeric Bezier value typed into the curve field", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();
    await openCurveEditor();

    const bezierInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="designEditor.motion.animationStyles.bezier"]',
    )!;
    const exactValue = "0.423, 0.125, 0.987, 0.875";
    await setInputValue(bezierInput, exactValue);

    expect(bezierInput.value).toBe(exactValue);
    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: {
          ...positionStyle.props,
          easing: "cubic-bezier(0.423, 0.125, 0.987, 0.875)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("drags the first Bezier handle and updates the source curve", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();
    await openCurveEditor();

    const preview = document.body.querySelector<SVGSVGElement>(
      'svg[aria-label="designEditor.motion.animationStyles.curvePreview"]',
    )!;
    setGraphBounds(preview);
    const handle = preview.querySelector<SVGCircleElement>(
      'circle[data-curve-handle="0"]',
    )!;
    expect(handle.getAttribute("role")).toBe("button");
    expect(handle.getAttribute("tabindex")).toBe("0");

    await dispatchPointer(handle, "pointerdown", 23, 77);
    await dispatchPointer(handle, "pointermove", 35, 50);
    await dispatchPointer(handle, "pointerup", 35, 50);

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: {
          ...positionStyle.props,
          easing: "cubic-bezier(0.224, 0.5, 0.58, 1)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("drags the second Bezier handle without changing the first", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();
    await openCurveEditor();

    const preview = document.body.querySelector<SVGSVGElement>(
      'svg[aria-label="designEditor.motion.animationStyles.curvePreview"]',
    )!;
    setGraphBounds(preview);
    const handle = preview.querySelector<SVGCircleElement>(
      'circle[data-curve-handle="1"]',
    )!;

    await dispatchPointer(handle, "pointerdown", 54, 23);
    await dispatchPointer(handle, "pointermove", 65, 34);
    await dispatchPointer(handle, "pointerup", 65, 34);

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: {
          ...positionStyle.props,
          easing: "cubic-bezier(0, 0, 0.776, 0.7944)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("maps Bezier pointer drags through the SVG screen transform", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();
    await openCurveEditor();

    const preview = document.body.querySelector<SVGSVGElement>(
      'svg[aria-label="designEditor.motion.animationStyles.curvePreview"]',
    )!;
    setGraphBounds(preview, 100, 80);
    const scale = 80 / 184;
    const translateX = 10 + 42 * scale;
    const translateY = 42 * scale;
    Object.defineProperty(preview, "getScreenCTM", {
      configurable: true,
      value: () =>
        ({
          a: scale,
          b: 0,
          c: 0,
          d: scale,
          e: translateX,
          f: translateY,
        }) as DOMMatrix,
    });
    const handle = preview.querySelector<SVGCircleElement>(
      'circle[data-curve-handle="0"]',
    )!;
    const clientX = 55 * scale + translateX;
    const clientY = 28 * scale + translateY;

    await dispatchPointer(handle, "pointerdown", clientX - 4, clientY - 4);
    await dispatchPointer(handle, "pointermove", clientX, clientY);
    await dispatchPointer(handle, "pointerup", clientX, clientY);

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: {
          ...positionStyle.props,
          easing: "cubic-bezier(0.55, 0.72, 0.58, 1)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("moves a focusable Bezier handle with arrow keys", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();
    await openCurveEditor();

    const handle = document.body.querySelector<SVGCircleElement>(
      'circle[data-curve-handle="0"]',
    )!;
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    });

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...positionStyle,
        props: {
          ...positionStyle.props,
          easing: "cubic-bezier(0.01, 0, 0.58, 1)",
        },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("does not rewrite an untouched spring Bounce value when focus leaves it", async () => {
    const styleWithSpring = {
      ...positionStyle,
      props: { ...positionStyle.props, easing: "spring(0.125)" },
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithSpring], onChange });
    await openStyleDetails();
    await openCurveEditor();

    const bounceLabel = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) =>
      label.textContent?.includes("designEditor.motion.bounce"),
    );
    const bounceInput = bounceLabel?.querySelector<HTMLInputElement>("input");
    if (!bounceInput) throw new Error("Missing spring Bounce input");

    onChange.mockClear();
    await act(async () => bounceInput.focus());
    await act(async () => bounceInput.blur());

    expect(onChange).not.toHaveBeenCalled();
    expect(bounceInput.value).toBe("0.125");
  });

  it("resets a clamped Bounce draft when it normalizes to the stored value", async () => {
    const styleWithSpring = {
      ...positionStyle,
      props: { ...positionStyle.props, easing: "spring(1)" },
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithSpring], onChange });
    await openStyleDetails();
    await openCurveEditor();

    const bounceLabel = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) =>
      label.textContent?.includes("designEditor.motion.bounce"),
    );
    const bounceInput = bounceLabel?.querySelector<HTMLInputElement>("input");
    if (!bounceInput) throw new Error("Missing spring Bounce input");

    onChange.mockClear();
    await act(async () => bounceInput.focus());
    await setInputValue(bounceInput, "2");
    await act(async () => bounceInput.blur());

    expect(onChange).not.toHaveBeenCalled();
    expect(bounceInput.value).toBe("1");
  });

  it("restores an invalid Bounce draft when it blurs", async () => {
    const styleWithSpring = {
      ...positionStyle,
      props: { ...positionStyle.props, easing: "spring(0.69, 0.5)" },
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithSpring], onChange });
    await openStyleDetails();
    await openCurveEditor();

    const bounceLabel = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) =>
      label.textContent?.includes("designEditor.motion.bounce"),
    );
    const bounceInput = bounceLabel?.querySelector<HTMLInputElement>("input");
    if (!bounceInput) throw new Error("Missing spring Bounce input");

    onChange.mockClear();
    await act(async () => bounceInput.focus());
    await setInputValue(bounceInput, "invalid");
    expect(bounceInput.value).toBe("invalid");
    await act(async () => bounceInput.blur());

    expect(onChange).not.toHaveBeenCalled();
    expect(bounceInput.value).toBe("0.69");
  });

  it("preserves an intermediate decimal in Bounce until blur, then commits it", async () => {
    const styleWithSpring = {
      ...positionStyle,
      props: { ...positionStyle.props, easing: "spring(0.69, 0.5)" },
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithSpring], onChange });
    await openStyleDetails();
    await openCurveEditor();

    expect(
      document.body.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("designEditor.motion.springTab");
    const preview = document.body.querySelector<SVGSVGElement>(
      'svg[aria-label="designEditor.motion.springCurvePreview"]',
    )!;
    expect(preview.dataset.easingCurve).toBe("spring(0.69, 0.5)");
    expect(
      preview.querySelector("path[data-curve-path]")?.getAttribute("d"),
    ).not.toBe("M 10 112 L 206 10");

    const curveTab = document.body.querySelector<HTMLButtonElement>(
      '[role="tab"]:not([aria-selected="true"])',
    )!;
    await act(async () => curveTab.focus());
    expect(curveTab.getAttribute("aria-selected")).toBe("true");
    expect(
      document.body.querySelector(
        'svg[aria-label="designEditor.motion.springCurvePreview"]',
      ),
    ).toBeNull();
    const springTab = document.body.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="false"]',
    )!;
    await act(async () => springTab.focus());
    expect(springTab.getAttribute("aria-selected")).toBe("true");

    const bounceLabel = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) =>
      label.textContent?.includes("designEditor.motion.bounce"),
    );
    const bounceInput = bounceLabel?.querySelector<HTMLInputElement>("input");
    expect(bounceInput).not.toBeNull();
    expect(
      Array.from(document.body.querySelectorAll("label")).some((label) =>
        label.textContent?.includes(
          "designEditor.motion.animationStyles.settle",
        ),
      ),
    ).toBe(false);

    onChange.mockClear();
    await act(async () => bounceInput?.focus());
    expect(onChange).not.toHaveBeenCalled();
    await setInputValue(bounceInput!, "0.");
    expect(bounceInput?.value).toBe("0.");
    expect(onChange).not.toHaveBeenCalled();
    await setInputValue(bounceInput!, "0.45");
    expect(bounceInput?.value).toBe("0.45");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      bounceInput?.blur();
    });
    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...styleWithSpring,
        props: { ...styleWithSpring.props, easing: "spring(0.45, 0.5)" },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("keeps a dirty Bounce draft when switching away from and back to Spring", async () => {
    const styleWithSpring = {
      ...positionStyle,
      props: { ...positionStyle.props, easing: "spring(0.69, 0.5)" },
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithSpring], onChange });
    await openStyleDetails();
    await openCurveEditor();

    const bounceInput = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    )
      .find((label) =>
        label.textContent?.includes("designEditor.motion.bounce"),
      )
      ?.querySelector<HTMLInputElement>("input");
    if (!bounceInput) throw new Error("Missing spring Bounce input");
    await setInputValue(bounceInput, "0.45");

    const curveTab = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "designEditor.motion.curveTab");
    if (!curveTab) throw new Error("Missing curve tab");
    await act(async () =>
      curveTab.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );

    const curveStyle = onChange.mock.lastCall?.[0] as
      | MotionNativeStyleInstance
      | undefined;
    expect(curveStyle?.props.easing).toBe("cubic-bezier(0, 0, 0.58, 1)");
    if (!curveStyle) throw new Error("Curve tab did not update the easing");

    await render({ styles: [curveStyle], onChange });
    onChange.mockClear();
    const springTab = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "designEditor.motion.springTab");
    if (!springTab) throw new Error("Missing spring tab");
    await act(async () =>
      springTab.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...curveStyle,
        props: { ...curveStyle.props, easing: "spring(0.45, 0.5)" },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("commits a dirty Bounce draft when the style editor closes before blur", async () => {
    const styleWithSpring = {
      ...positionStyle,
      props: { ...positionStyle.props, easing: "spring(0.69, 0.5)" },
    };
    const onChange = vi.fn();
    await render({ styles: [styleWithSpring], onChange });
    await openStyleDetails();
    await openCurveEditor();

    const bounceInput = Array.from(
      document.body.querySelectorAll<HTMLLabelElement>("label"),
    )
      .find((label) =>
        label.textContent?.includes("designEditor.motion.bounce"),
      )
      ?.querySelector<HTMLInputElement>("input");
    if (!bounceInput) throw new Error("Missing spring Bounce input");
    await setInputValue(bounceInput, "0.45");
    onChange.mockClear();

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.close"]',
    );
    if (!closeButton) throw new Error("Missing style editor close button");
    await act(async () => closeButton.click());

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...styleWithSpring,
        props: { ...styleWithSpring.props, easing: "spring(0.45, 0.5)" },
      },
      expect.objectContaining({ index: 0, styleKey: "Position" }),
    );
  });

  it("shows the style-key menu separately from Type and keeps close functional", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.close"]',
    )!;
    expect(closeButton.parentElement?.querySelectorAll("button")).toHaveLength(
      2,
    );
    const styleKeySelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.position"]',
    )!;
    expect(styleKeySelect).not.toBeNull();
    expect(
      closeButton.parentElement?.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).toBeNull();
    expect(
      document.body.querySelector(
        'button[aria-label="designEditor.motion.type"]',
      ),
    ).not.toBeNull();
    await act(async () => closeButton.click());
    expect(
      document.body.querySelector(
        '[aria-label="designEditor.motion.animationStyles.curvePreview"]',
      ),
    ).toBeNull();
    await openStyleDetails();
    const reopenedStyleKeySelect =
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.animationStyles.position"]',
      )!;
    await selectOption(
      reopenedStyleKeySelect,
      "designEditor.motion.animationStyles.scale",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        styleKey: "Scale",
        nameKey: "motion.preset_name.scale",
        duration: positionStyle.duration,
        timelineOffset: positionStyle.timelineOffset,
        sourceStyleId: positionStyle.sourceStyleId,
        sourceInstanceId: positionStyle.sourceInstanceId,
        props: expect.objectContaining({
          type: "scaleIn",
          amount: 120,
          delay: positionStyle.props.delay,
          easing: positionStyle.props.easing,
          futureProperty: positionStyle.props.futureProperty,
        }),
      }),
      expect.objectContaining({ styleKey: "Position", index: 0 }),
    );
  });

  it("keeps sequential Text, Position, and Scale style changes selectable", async () => {
    const textStyle = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    const onTextChange = vi.fn();
    await render({ styles: [textStyle], onChange: onTextChange });
    await openStyleDetails();
    await selectOption(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.animationStyles.text"]',
      )!,
      "designEditor.motion.animationStyles.position",
    );

    const position = onTextChange.mock.lastCall?.[0];
    expect(position).toMatchObject({
      styleKey: "Position",
      props: {
        type: "slide_in",
        direction: "left",
        distance: 200,
      },
    });
    if (!position) throw new Error("Text style did not switch to Position");
    const onPositionChange = vi.fn();
    await render({ styles: [position], onChange: onPositionChange });
    if (
      !document.body.querySelector(
        'button[aria-label="designEditor.motion.animationStyles.position"]',
      )
    ) {
      await openStyleDetails();
    }
    await selectOption(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="designEditor.motion.animationStyles.position"]',
      )!,
      "designEditor.motion.animationStyles.scale",
    );

    expect(onPositionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        styleKey: "Scale",
        props: expect.objectContaining({ type: "scaleIn", amount: 120 }),
      }),
      expect.objectContaining({ styleKey: "Position", index: 0 }),
    );
  });

  it("toggles visibility on the native instance and removes by stable identity", async () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    await render({ onChange, onRemove });

    const visibilityButton = container.querySelector<HTMLButtonElement>(
      'li button[aria-label^="designEditor.motion.animationStyles.hide"]',
    )!;
    await act(async () => visibilityButton.click());
    expect(onChange).toHaveBeenLastCalledWith(
      { ...positionStyle, enabled: false },
      expect.objectContaining({
        key: JSON.stringify(["Position", "target-1", 0]),
        index: 0,
      }),
    );

    const removeButton = container.querySelector<HTMLButtonElement>(
      'li button[aria-label^="designEditor.motion.animationStyles.removeAnimation"]',
    )!;
    await act(async () => removeButton.click());
    expect(onRemove).toHaveBeenCalledWith({
      key: JSON.stringify(["Position", "target-1", 0]),
      styleKey: "Position",
      targetNodeId: "target-1",
      index: 0,
      sourceInstanceId: "instance-1",
    });
  });

  it("edits native Path trim endpoints while preserving opaque source props", async () => {
    const onChange = vi.fn();
    const pathStyle = {
      ...createMotionNativeStyleInstance({
        styleKey: "Path",
        targetNodeId: "target-1",
      }),
      props: {
        ...createMotionNativeStyleInstance({
          styleKey: "Path",
          targetNodeId: "target-1",
        }).props,
        futurePathField: { keep: true },
      },
    };
    await render({ styles: [pathStyle], onChange });
    await openStyleDetails();

    expect(document.body.textContent).toContain(
      "designEditor.motion.nativePathTrim.startAtBeginning",
    );
    expect(document.body.querySelectorAll('input[type="number"]')).toHaveLength(
      6,
    );
    await setInputValue(
      document.body.querySelector<HTMLInputElement>('input[type="number"]')!,
      "75",
    );

    expect(onChange).toHaveBeenLastCalledWith(
      {
        ...pathStyle,
        props: {
          ...pathStyle.props,
          pathStartStartFrame: 75,
        },
      },
      expect.objectContaining({ styleKey: "Path", index: 0 }),
    );
  });
});
