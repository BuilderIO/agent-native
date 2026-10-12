// @vitest-environment happy-dom

import type { MotionEasingVariable } from "@shared/motion-easing";
import type { MotionNativeStyleInstance } from "@shared/motion-native-style";
import { createMotionNativeStyleInstance } from "@shared/motion-native-style-runtime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MotionEasingPicker,
  MotionNativeStyleEditor,
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
  }

  async function clickButtonWithText(text: string) {
    const button = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === text);
    if (!button) throw new Error(`Missing button ${text}`);
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
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(input, value);
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

  async function openEasingPicker() {
    const trigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeOut"]',
    );
    if (!trigger) throw new Error("Missing easing picker trigger");
    await act(async () => trigger.click());
  }

  it("orders easing presets like Figma, with Hold first", async () => {
    await renderPicker();
    await openEasingPicker();

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
      "designEditor.motion.animationStyles.toLeft",
      "designEditor.motion.animationStyles.toRight",
      "designEditor.motion.animationStyles.toTop",
      "designEditor.motion.animationStyles.toBottom",
      "designEditor.motion.animationStyles.toTopLeft",
      "designEditor.motion.animationStyles.toTopRight",
      "designEditor.motion.animationStyles.toBottomLeft",
      "designEditor.motion.animationStyles.toBottomRight",
    ]);
    await act(async () => directionOptions[0]?.click());

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

  it("edits native TextStagger controls without discarding source props", async () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "target-1",
    });
    const style = {
      ...base,
      sourceInstanceId: "figma-text-instance",
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

    const positionSwitch = document.body.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="designEditor.motion.nativeTextStagger.effects.position"]',
    );
    expect(positionSwitch).not.toBeNull();
    await act(async () => positionSwitch!.click());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceInstanceId: "figma-text-instance",
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
        sourceInstanceId: "figma-text-instance",
        props: expect.objectContaining({
          textDelayGrouping: "WORD",
          futureTextProp: { keep: true },
        }),
      }),
      expect.objectContaining({ styleKey: "TextStagger", index: 0 }),
    );
  });

  it("keeps unknown native properties while editing known fields", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openStyleDetails();

    const directionSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.motion.textAnimation.direction"]',
    )!;
    await selectOption(
      directionSelect,
      "designEditor.motion.animationStyles.toTop",
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

    const easingSelect = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeOut"]',
    )!;
    await act(async () => easingSelect.click());
    await clickButtonWithText(
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

  it("orders easing choices like Figma's curve and spring controls", async () => {
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
    await clickButtonWithText(
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
    await clickButtonWithText(
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
    await setInputValue(bounceInput, "0.42");
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
    await clickButtonWithText(
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

  it("shows the selected spring curve with one Bounce control and preserves settle", async () => {
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

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(bounceInput, "0.45");
      bounceInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
