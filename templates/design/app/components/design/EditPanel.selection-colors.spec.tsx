// @vitest-environment happy-dom

import { parseCssColor, rgbaToHex } from "@shared/color-utils";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useDesignHotkeys } from "@/hooks/useDesignHotkeys";

import type { SelectionColorValue } from "./edit-panel/document-colors";
import { SelectionColorsProperties } from "./EditPanel";
import type { ElementInfo } from "./types";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

it("opens a selection color from one click and keeps the picker open while editing", async () => {
  const onCommit = vi.fn();
  function Harness() {
    const [color, setColor] = useState("#dadada");
    const element: ElementInfo = {
      tagName: "DIV",
      classes: [],
      computedStyles: { backgroundColor: color },
      boundingRect: { x: 0, y: 0, width: 100, height: 100 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    return (
      <TooltipProvider>
        <SelectionColorsProperties
          elements={[element]}
          onColorChange={(from, to, meta) => {
            setColor(to);
            if (meta?.phase === "commit") onCommit(from, to);
          }}
        />
      </TooltipProvider>
    );
  }
  await act(() => root.render(<Harness />));
  const showColors = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Show selection colors",
  )!;
  await act(() => showColors.click());
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="#dadada"]')!
      .click(),
  );
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Hex"]',
  );
  expect(input).not.toBeNull();
  await act(() => {
    input!.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "DEDCF9");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    input!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(onCommit).toHaveBeenCalledWith("#dadada", "#dedcf9");
  expect(document.querySelector('input[aria-label="Hex"]')).toBe(input);
  expect(container.textContent).toContain("DEDCF9");
});

it("closes the picker and restores the live swatch after a refused commit", async () => {
  const onColorChange = vi.fn(
    (_from: string, _to: string, meta?: { phase?: string }) =>
      meta?.phase === "commit" ? false : undefined,
  );
  await act(() =>
    root.render(
      <TooltipProvider>
        <SelectionColorsProperties
          colors={[{ property: "color", value: "#dadada" }]}
          elements={[]}
          onColorChange={onColorChange}
        />
      </TooltipProvider>,
    ),
  );

  await act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Show selection colors")!
      .click(),
  );
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="#dadada"]')!
      .click(),
  );
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Hex"]',
  )!;
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "EC4899");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );

  expect(onColorChange).toHaveBeenCalledWith("#dadada", "#ec4899", {
    phase: "commit",
  });
  expect(document.querySelector('input[aria-label="Hex"]')).toBeNull();
  expect(
    container.querySelector('button[aria-label="#dadada"]'),
  ).not.toBeNull();
});

it("ignores the color picker's late commit after a refused preview", async () => {
  const onColorChange = vi.fn(
    (_from: string, _to: string, _meta?: { phase?: string }) => false,
  );
  await act(() =>
    root.render(
      <TooltipProvider>
        <SelectionColorsProperties
          colors={[{ property: "color", value: "#dadada" }]}
          elements={[]}
          onColorChange={onColorChange}
        />
      </TooltipProvider>,
    ),
  );

  await act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Show selection colors")!
      .click(),
  );
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="#dadada"]')!
      .click(),
  );
  const opacity = document.querySelector<HTMLDivElement>(
    '[role="slider"][aria-label="Opacity"]',
  );
  expect(opacity).not.toBeNull();
  await act(() =>
    opacity!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    ),
  );

  expect(onColorChange).toHaveBeenCalledTimes(1);
  const [from, to, meta] = onColorChange.mock.calls[0]!;
  expect(from).toBe("#dadada");
  expect(parseCssColor(to)).toEqual({ r: 218, g: 218, b: 218, a: 0.99 });
  expect(meta).toEqual({ phase: "preview" });
  expect(document.querySelector('input[aria-label="Hex"]')).toBeNull();
  expect(
    container.querySelector('button[aria-label="#dadada"]'),
  ).not.toBeNull();
});

it("keeps the active picker mounted when its preview collides with another swatch", async () => {
  const originalColors: SelectionColorValue[] = [
    { property: "color", value: "#3b82f6" },
    { property: "color", value: "rgba(59,130,246,0.5)" },
  ];
  const changes: Array<{
    from: string;
    meta?: { phase?: string };
    to: string;
  }> = [];

  function Harness() {
    const [colors, setColors] = useState(originalColors);
    return (
      <TooltipProvider>
        <SelectionColorsProperties
          colors={colors}
          elements={[]}
          onColorChange={(from, to, meta) => {
            changes.push({ from, to, meta });
            if (meta?.phase !== "preview") return;
            const parsed = parseCssColor(to);
            const opaqueBlue = parseCssColor("#3b82f6");
            if (
              parsed &&
              opaqueBlue &&
              rgbaToHex(parsed, true) === rgbaToHex(opaqueBlue, true)
            ) {
              setColors([originalColors[0]!]);
            }
          }}
        />
      </TooltipProvider>
    );
  }

  await act(() => root.render(<Harness />));
  const showColors = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Show selection colors",
  )!;
  await act(() => showColors.click());
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="rgba(59,130,246,0.5)"]',
      )!
      .click(),
  );
  const slider = document.querySelector<HTMLDivElement>(
    '[role="slider"][aria-label="Opacity"]',
  );
  expect(slider).not.toBeNull();
  Object.defineProperty(slider!, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 14,
        width: 100,
        height: 14,
        toJSON: () => ({}),
      }) as DOMRect,
  });
  const pointer = (type: string) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: "mouse",
      clientX: 100,
    });

  await act(() => slider!.dispatchEvent(pointer("pointerdown")));
  expect(slider!.getAttribute("aria-valuenow")).toBe("100");
  expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
  await act(() => slider!.dispatchEvent(pointer("pointerup")));

  expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
  expect(
    container.querySelectorAll('button[aria-label="#3b82f6"]'),
  ).toHaveLength(2);
  expect(changes[changes.length - 1]).toMatchObject({
    from: "rgba(59,130,246,0.5)",
    meta: { phase: "commit" },
  });

  for (let index = 0; index < 20; index += 1) {
    await act(() =>
      slider!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    );
  }
  expect(slider!.getAttribute("aria-valuenow")).toBe("80");
  expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
  expect(changes[changes.length - 1]).toMatchObject({
    from: "rgba(59,130,246,0.5)",
    meta: { phase: "commit" },
  });
});

it("closes the idle picker before Undo and Redo reach the editor", async () => {
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  function Harness() {
    useDesignHotkeys({ onUndo, onRedo });
    return (
      <TooltipProvider>
        <SelectionColorsProperties
          colors={[{ property: "color", value: "#dadada" }]}
          elements={[]}
          onColorChange={() => undefined}
        />
      </TooltipProvider>
    );
  }
  await act(() => root.render(<Harness />));

  const openPicker = async () => {
    const showColors = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show selection colors",
    );
    if (showColors) {
      await act(() => showColors.click());
    }
    await act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="#dadada"]')!
        .click(),
    );
  };

  await openPicker();
  const undoInput = document.querySelector<HTMLInputElement>(
    'input[aria-label="Hex"]',
  );
  expect(undoInput).not.toBeNull();
  await act(() =>
    undoInput!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('input[aria-label="Hex"]')).toBeNull();
  expect(onUndo).toHaveBeenCalledTimes(1);

  await openPicker();
  const redoInput = document.querySelector<HTMLInputElement>(
    'input[aria-label="Hex"]',
  );
  expect(redoInput).not.toBeNull();
  await act(() =>
    redoInput!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('input[aria-label="Hex"]')).toBeNull();
  expect(onRedo).toHaveBeenCalledTimes(1);
});

it("cancels an active opacity drag without closing or late-committing it", async () => {
  const onColorChange = vi.fn();
  await act(() =>
    root.render(
      <TooltipProvider>
        <SelectionColorsProperties
          colors={[{ property: "color", value: "rgba(59,130,246,0.5)" }]}
          elements={[]}
          onColorChange={onColorChange}
        />
      </TooltipProvider>,
    ),
  );

  await act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Show selection colors")!
      .click(),
  );
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="rgba(59,130,246,0.5)"]',
      )!
      .click(),
  );
  const slider = document.querySelector<HTMLDivElement>(
    '[role="slider"][aria-label="Opacity"]',
  )!;
  Object.defineProperty(slider, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 14,
        width: 100,
        height: 14,
        toJSON: () => ({}),
      }) as DOMRect,
  });
  const pointer = (type: string, clientX: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 11,
      pointerType: "mouse",
      clientX,
    });

  await act(() => slider.dispatchEvent(pointer("pointerdown", 50)));
  await act(() => slider.dispatchEvent(pointer("pointermove", 70)));
  expect(slider.getAttribute("aria-valuenow")).toBe("70");
  await act(() =>
    slider.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(slider.getAttribute("aria-valuenow")).toBe("50");
  expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
  expect(onColorChange).toHaveBeenCalledWith(
    "rgba(59,130,246,0.5)",
    "rgba(59, 130, 246, 0.5)",
    { phase: "cancel" },
  );

  await act(() => slider.dispatchEvent(pointer("pointerup", 70)));
  expect(slider.getAttribute("aria-valuenow")).toBe("50");
  expect(
    onColorChange.mock.calls.some(([, , meta]) => meta?.phase === "commit"),
  ).toBe(false);
  expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
});
