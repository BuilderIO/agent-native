// @vitest-environment happy-dom

import type {
  MotionAnimationStyleDefinition,
  MotionAnimationStyleMetadata,
  MotionAnimationStyleTrackDefinition,
} from "@shared/motion-animation-styles";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MotionAnimationStyle } from "@/pages/design-editor/motion-animation-style";

import { AnimationStyleBrowser } from "./AnimationStyleBrowser";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const styles: MotionAnimationStyleDefinition[] = [
  {
    id: "fade-in",
    name: "Fade In",
    category: "enter",
    description: "A short opacity entrance",
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1" },
        ],
      },
    ],
  },
  {
    id: "float-cycle",
    name: "Float",
    category: "cycle",
    tracks: [
      {
        property: "translate",
        keyframes: [
          { t: 0, value: "0px 0px" },
          { t: 1, value: "0px -12px" },
        ],
      },
    ],
  },
];

const selectedTargetTracks: MotionAnimationStyleTrackDefinition[] = [
  {
    property: "opacity",
    keyframes: [
      { t: 0, value: "0", ease: "ease-out" },
      { t: 1, value: "1" },
    ],
  },
];

const basicStyles = [
  {
    label: "Position",
    kind: "individual" as const,
    preset: {
      property: "translate",
      label: "Position",
      group: "primary" as const,
    },
  },
  {
    label: "Opacity",
    kind: "individual" as const,
    preset: {
      property: "opacity",
      label: "Opacity",
      group: "primary" as const,
    },
  },
];

const messages: Record<string, string> = {
  "designEditor.motion.animationStyles.title": "Animations",
  "designEditor.motion.animationStyles.search": "Search animation styles",
  "designEditor.motion.animationStyles.searchPlaceholder": "Search",
  "designEditor.motion.animationStyles.filter": "Filter animation styles",
  "designEditor.motion.animationStyles.list": "Animation styles",
  "designEditor.motion.animationStyles.all": "All",
  "designEditor.motion.animationStyles.basic": "Basic",
  "designEditor.motion.animationStyles.enter": "Enter",
  "designEditor.motion.animationStyles.cycle": "Cycle",
  "designEditor.motion.animationStyles.exit": "Exit",
  "designEditor.motion.animationStyles.create": "Create style",
  "designEditor.motion.animationStyles.close": "Close",
  "designEditor.motion.animationStyles.createTitle":
    "Create new animation style",
  "designEditor.motion.animationStyles.addAnimation": "Add animation",
  "designEditor.motion.animationStyles.animation": "Animation",
  "designEditor.motion.animationStyles.text": "Text",
  "designEditor.motion.animationStyles.position": "Position",
  "designEditor.motion.animationStyles.scale": "Scale",
  "designEditor.motion.animationStyles.rotation": "Rotation",
  "designEditor.motion.animationStyles.size": "Size",
  "designEditor.motion.animationStyles.opacity": "Opacity",
  "designEditor.motion.animationStyles.path": "Path",
  "designEditor.motion.animationStyles.empty": "No animation styles",
  "designEditor.motion.animationStyles.noResults": "No matching styles",
  "designEditor.motion.animationStyles.noAnimations": "Add an animation",
  "designEditor.motion.animationStyles.name": "Name",
  "designEditor.motion.animationStyles.description": "Description",
  "designEditor.motion.animationStyles.hide": "Hide",
  "designEditor.motion.animationStyles.show": "Show",
  "designEditor.motion.animationStyles.removeAnimation": "Remove animation",
  "designEditor.motion.animationStyles.save": "Create style",
};

describe("AnimationStyleBrowser", () => {
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
      styles: MotionAnimationStyleDefinition[];
      basicStyles: typeof basicStyles;
      selectedTargetTracks: MotionAnimationStyleTrackDefinition[];
      disabled: boolean;
      onApply: (style: MotionAnimationStyleDefinition) => void;
      onApplyPreset: (style: MotionAnimationStyle) => void;
      onSaveStyle: (
        metadata: MotionAnimationStyleMetadata,
        tracks: MotionAnimationStyleTrackDefinition[],
      ) => void;
      onClose: () => void;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <AnimationStyleBrowser
          styles={styles}
          basicStyles={basicStyles}
          selectedTargetTracks={selectedTargetTracks}
          onApply={vi.fn()}
          onApplyPreset={vi.fn()}
          onSaveStyle={vi.fn()}
          onClose={vi.fn()}
          t={(key) => messages[key] ?? key}
          {...overrides}
        />,
      );
    });
  }

  async function setValue(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function selectCategory(category: string) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Filter animation styles"]',
    );
    await act(async () => trigger?.click());
    const option = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role='option']"),
    ).find((item) => item.textContent === category);
    expect(option).not.toBeNull();
    await act(async () => option!.click());
  }

  it("filters saved styles by category and searchable metadata", async () => {
    await render();

    expect(container.textContent).toContain("Fade In");
    expect(container.textContent).toContain("Float");
    expect(container.textContent).toContain("Position");

    await selectCategory("Enter");
    expect(container.textContent).toContain("Fade In");
    expect(container.textContent).not.toContain("Float");
    expect(container.textContent).not.toContain("Position");

    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search animation styles"]',
    );
    expect(search).not.toBeNull();
    await setValue(search!, "opacity entrance");
    expect(container.textContent).toContain("Fade In");

    await setValue(search!, "not a style");
    expect(container.textContent).toContain("No matching styles");
  });

  it("applies a saved style when its row is clicked", async () => {
    const onApply = vi.fn();
    await render({ onApply });

    const styleRow = container.querySelector<HTMLButtonElement>("#fade-in");
    expect(styleRow).not.toBeNull();
    await act(async () => styleRow!.click());
    expect(onApply).toHaveBeenCalledWith(styles[0]);
  });

  it("applies basic properties directly", async () => {
    const onApplyPreset = vi.fn();
    await render({ onApplyPreset });

    const positionRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Position");
    expect(positionRow).not.toBeNull();
    await act(async () => positionRow!.click());
    expect(onApplyPreset).toHaveBeenCalledWith(basicStyles[0]);
  });

  it("creates a source style from selected animation tracks", async () => {
    const onSaveStyle = vi.fn();
    await render({ onSaveStyle });

    const createButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Create style"]',
    );
    expect(createButton?.disabled).toBe(false);
    await act(async () => createButton!.click());

    const nameInput =
      document.body.querySelector<HTMLInputElement>("#motion-style-name");
    const descriptionInput = document.body.querySelector<HTMLInputElement>(
      "#motion-style-description",
    );
    expect(nameInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();
    await setValue(nameInput!, "  Fade Up  ");
    await setValue(descriptionInput!, "Starts just below the final position");

    const addAnimation = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Add animation"]',
    );
    await act(async () => addAnimation?.click());
    const opacityItem = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
    ).find((item) => item.textContent === "Opacity");
    expect(opacityItem?.disabled).toBe(false);
    await act(async () => opacityItem!.click());

    const saveButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Create style");
    expect(saveButton?.disabled).toBe(false);
    await act(async () => saveButton!.click());

    expect(onSaveStyle).toHaveBeenCalledOnce();
    expect(onSaveStyle).toHaveBeenCalledWith(
      {
        name: "Fade Up",
        category: "basic",
        description: "Starts just below the final position",
      },
      selectedTargetTracks,
    );
  });

  it("disables style creation without selected target tracks", async () => {
    await render({ selectedTargetTracks: [] });
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Create style"]',
      )?.disabled,
    ).toBe(true);
  });
});
