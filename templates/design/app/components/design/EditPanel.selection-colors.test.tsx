// @vitest-environment happy-dom

/**
 * The Selection colors rows read each color the way the Fill field does: hex in
 * capitals, Display P3 and OKLCH in their own notation with the percent left out
 * at 100%, and a count after a color the selection uses more than once.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { SelectionColorsProperties } from "./EditPanel";

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

function renderExpanded(colors: Array<{ value: string; count?: number }>) {
  const withProperty = colors.map((color) => ({
    property: "backgroundColor",
    ...color,
  }));
  act(() =>
    root.render(
      <TooltipProvider>
        <SelectionColorsProperties
          elements={[]}
          colors={withProperty}
          onColorChange={vi.fn()}
        />
      </TooltipProvider>,
    ),
  );
  act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Show selection colors"))!
      .click(),
  );
}

const row = (value: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${value}"]`)!;

describe("Selection colors rows", () => {
  it("read hex in capitals with the opacity", () => {
    renderExpanded([
      { value: "#171717" },
      { value: "rgba(10, 107, 214, 0.5)" },
    ]);
    expect(row("#171717").textContent).toBe("171717100%");
    expect(row("rgba(10, 107, 214, 0.5)").textContent).toBe("0A6BD650%");
  });

  it("read Display P3 and OKLCH in their own notation, with the percent left out at 100%", () => {
    renderExpanded([
      { value: "color(display-p3 0.09 0.09 0.09)" },
      { value: "oklch(72.4% 0.181 153)" },
    ]);
    expect(row("color(display-p3 0.09 0.09 0.09)").textContent).toBe(
      "P3 0.09 0.09 0.09",
    );
    expect(row("oklch(72.4% 0.181 153)").textContent).toBe(
      "OKLCH 72.4 0.181 153",
    );
    expect(row("oklch(72.4% 0.181 153)").title).toBe("oklch(72.4% 0.181 153)");
  });

  it("count a color the selection uses more than once", () => {
    renderExpanded([{ value: "#171717", count: 3 }]);
    expect(row("#171717").textContent).toBe("171717100%×3");
  });
});
