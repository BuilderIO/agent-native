// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DesignColorPicker } from "./DesignColorPicker";

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

function render(documentColors: string[], open: boolean) {
  act(() => {
    root.render(
      <TooltipProvider>
        <DesignColorPicker
          value="#ff0000"
          onChange={() => {}}
          open={open}
          onOpenChange={() => {}}
          documentColors={documentColors}
          trigger={<button type="button">Open picker</button>}
        />
      </TooltipProvider>,
    );
  });
}

const swatchCount = () =>
  document.querySelectorAll(".grid.grid-cols-8 > *").length;

it("keeps the document palette fixed while the picker is open", () => {
  render(["#111111", "#222222"], true);
  expect(swatchCount()).toBe(2);

  render(["#111111", "#222222", "#333333"], true);
  expect(swatchCount()).toBe(2);

  render(["#111111", "#222222", "#333333"], false);
  render(["#111111", "#222222", "#333333"], true);
  expect(swatchCount()).toBe(3);
});

it("a press on the saturation field does not start a text selection", () => {
  render([], true);
  const field = document.querySelector<HTMLElement>(
    '[aria-label="Saturation and brightness"]',
  )!;
  field.setPointerCapture = () => {};
  const press = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
  });
  act(() => {
    field.dispatchEvent(press);
  });
  expect(press.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(field);
});
