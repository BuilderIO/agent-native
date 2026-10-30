// @vitest-environment happy-dom

import { FONT_SIZE_SCALE } from "@agent-native/toolkit/design-tweaks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import type { ElementInfo } from "../types";
import { MIXED_VALUE } from "./selection-helpers";
import type { StyleChangeHandler } from "./style-change-types";
import { TypographyProperties } from "./typography-properties";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function textElement(fontSize: string): ElementInfo {
  return {
    tagName: "P",
    classes: [],
    primitiveKind: "text",
    hasOwnText: true,
    textContent: "Hello",
    computedStyles: { color: "rgb(0, 0, 0)", fontSize },
    boundingRect: { x: 0, y: 0, width: 80, height: 20 },
    parentBoundingRect: { x: 0, y: 0, width: 800, height: 600 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    sourceId: "text-1",
  };
}

function renderTypography(fontSize: string) {
  const onStyleChange = vi.fn<StyleChangeHandler>();
  act(() =>
    root.render(
      <TooltipProvider>
        <TypographyProperties
          element={textElement(fontSize)}
          onStyleChange={onStyleChange}
        />
      </TooltipProvider>,
    ),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="editPanel.labels.size"]',
  );
  if (!input) throw new Error("missing size field");
  return { onStyleChange, input };
}

function openSizes() {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="editPanel.labels.fontSizes"]',
  );
  if (!trigger) throw new Error("missing size list trigger");
  act(() => trigger.click());
  return Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]"));
}

function setDraft(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("missing input value setter");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("typography font size field", () => {
  it("shows a bare number with a scrub handle and no stepper buttons", () => {
    const { input } = renderTypography("18px");

    expect(input.value).toBe("18");
    expect(container.textContent).not.toContain("px");
    expect(container.querySelector("[data-font-size-scrub]")).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label*="ncrease"], [aria-label*="ecrease"]',
      ),
    ).toBeNull();
  });

  it("previews a scrub and commits it once on release", () => {
    const { onStyleChange } = renderTypography("14px");
    const handle = container.querySelector<HTMLElement>(
      "[data-font-size-scrub]",
    );
    if (!handle) throw new Error("missing scrub handle");
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();
    const pointer = (type: string, clientX: number) =>
      Object.assign(new Event(type, { bubbles: true }), {
        pointerId: 1,
        clientX,
        button: 0,
      });

    act(() => {
      handle.dispatchEvent(pointer("pointerdown", 0));
    });
    act(() => {
      handle.dispatchEvent(pointer("pointermove", 6));
    });
    act(() => {
      handle.dispatchEvent(pointer("pointerup", 6));
    });

    expect(onStyleChange.mock.calls).toEqual([
      ["fontSize", "20px", { phase: "preview" }],
      ["fontSize", "20px", { phase: "commit" }],
    ]);
  });

  it("applies a typed Mixed expression to each element", () => {
    const { onStyleChange, input } = renderTypography(MIXED_VALUE);

    act(() => input.focus());
    act(() => setDraft(input, `${MIXED_VALUE}+2`));
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onStyleChange).toHaveBeenCalledWith(
      "fontSize",
      expect.any(String),
      expect.objectContaining({
        phase: "commit",
        relativeExpression: expect.objectContaining({
          expression: "Mixed+2",
          unit: "px",
          min: 1,
        }),
      }),
    );
  });

  it("lists the shared type scale with the current size highlighted", () => {
    renderTypography("14px");

    const options = openSizes();

    expect(options.map((option) => option.textContent)).toEqual(
      FONT_SIZE_SCALE.map(String),
    );
    const current = options.find(
      (option) => option.getAttribute("data-current") === "true",
    );
    expect(current?.textContent).toBe("14");
  });

  it("commits a picked size", () => {
    const { onStyleChange } = renderTypography("14px");

    const option = openSizes().find((item) => item.textContent === "32");
    if (!option) throw new Error("missing 32 option");
    act(() => option.click());

    expect(onStyleChange).toHaveBeenCalledWith("fontSize", "32px", {
      phase: "commit",
    });
  });

  it("commits a typed size with one decimal and ignores invalid input", () => {
    const { onStyleChange, input } = renderTypography("14px");

    act(() => input.focus());
    act(() => setDraft(input, "15.55"));
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    act(() => setDraft(input, "0"));
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onStyleChange.mock.calls).toEqual([
      ["fontSize", "15.6px", { phase: "commit" }],
    ]);
  });

  it("steps through the scale with the arrow keys", () => {
    const { onStyleChange, input } = renderTypography("14px");

    act(() => input.focus());
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });

    expect(onStyleChange).toHaveBeenCalledWith("fontSize", "15px", {
      phase: "commit",
    });
  });

  it("shows Mixed for a mixed selection", () => {
    const { input } = renderTypography(MIXED_VALUE);

    expect(input.value).toBe(MIXED_VALUE);
  });
});
