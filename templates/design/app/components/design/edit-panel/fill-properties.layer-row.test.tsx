// @vitest-environment happy-dom

/**
 * A layer row's reorder handle sits in its own leading cell, outside the field
 * pill, so the pill is the same width and starts at the same edge as every
 * other inspector control; the freed width lets a Display P3 or OKLCH reading
 * show whole.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({ isSuccess: false }),
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return {
    ...actual,
    FieldTrailer: () => null,
  };
});

import type { ElementInfo } from "../types";
import { FillProperties } from "./fill-properties";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const STORED_OKLCH = "oklch(70.8312% 0.157349 153.2147)";

function layeredElement(...layers: string[]): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: layers.join(", "),
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    },
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
  } as ElementInfo;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderLayers(...layers: string[]) {
  act(() =>
    root.render(
      <FillProperties
        element={layeredElement(...layers)}
        onStyleChange={vi.fn()}
        onStylesChange={vi.fn()}
      />,
    ),
  );
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-inspector-layout="drag-paint-row"]',
    ),
  );
  return rows.map((row) => ({
    row,
    handle: row.querySelector<HTMLElement>(
      '[aria-label="editPanel.labels.reorderLayer"]',
    )!,
    trigger: row.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!,
  }));
}

describe("FillProperties layer row", () => {
  it("keeps the reorder handle in its own cell, outside the field pill", () => {
    const [{ row, handle, trigger }] = renderLayers(
      "linear-gradient(#ff0000 0 0)",
      "linear-gradient(#0000ff 0 0)",
    );

    expect(handle).not.toBeNull();
    expect(trigger).not.toBeNull();
    expect(trigger.contains(handle)).toBe(false);
    expect(handle.closest("button")).toBeNull();
    // Handle first, then the field: the row's grid gives the handle the
    // gutter column and the field the content column.
    expect(row.children[0]!.contains(handle)).toBe(true);
    expect(row.children[1]!.contains(trigger)).toBe(true);
    expect(row.children[0]!.contains(trigger)).toBe(false);
    // The pill keeps its own padding only; it no longer makes room for the handle.
    expect(trigger.className).not.toMatch(/(^|\s)pl-\d/);
  });

  it("reads OKLCH whole, with the stored color in a title and no chevron", () => {
    const [oklchRow, hexRow] = renderLayers(
      `linear-gradient(${STORED_OKLCH} 0 0)`,
      "linear-gradient(#ff0000 0 0)",
    );

    expect(oklchRow!.trigger.textContent).toBe("OKLCH 70.8 0.157 153.2");
    expect(oklchRow!.trigger.title).toBe(STORED_OKLCH);
    expect(oklchRow!.trigger.querySelector("svg")).toBeNull();

    // Other readings are untouched: hex still has its opacity and chevron.
    expect(hexRow!.trigger.textContent).toBe("FF0000100%");
    expect(hexRow!.trigger.title).toBe("");
    expect(hexRow!.trigger.querySelector("svg")).not.toBeNull();
  });

  it("leaves Display P3 as three decimals and also without a chevron", () => {
    const [{ trigger }] = renderLayers(
      "linear-gradient(color(display-p3 0.123456 0.5 0.987654) 0 0)",
    );

    expect(trigger.textContent).toBe("P3 0.123 0.5 0.988");
    expect(trigger.title).toBe("color(display-p3 0.123456 0.5 0.987654)");
    expect(trigger.querySelector("svg")).toBeNull();
  });

  it("shows the opacity of a translucent OKLCH layer after the numbers", () => {
    const [{ trigger }] = renderLayers(
      "linear-gradient(oklch(70.8312% 0.157349 153.2147 / 0.4) 0 0)",
    );

    expect(trigger.textContent).toBe("OKLCH 70.8 0.157 153.240%");
  });
});
