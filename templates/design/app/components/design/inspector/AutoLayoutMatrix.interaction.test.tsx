// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import {
  AutoLayoutMatrix,
  type AutoLayoutMatrixValue,
} from "./AutoLayoutMatrix";

const value: AutoLayoutMatrixValue = {
  direction: "horizontal",
  wrap: "nowrap",
  alignment: { horizontal: "left", vertical: "top" },
  gap: 8,
  padding: { top: 4, right: 4, bottom: 4, left: 4 },
  paddingLinked: true,
  childSizing: { horizontal: "fixed", vertical: "fixed" },
  display: "block",
};

describe("AutoLayoutMatrix Flow interactions", () => {
  it("uses the atomic Flow callback without emitting three individual changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onFlowChange = vi.fn();
    const onDisplayChange = vi.fn();
    const onDirectionChange = vi.fn();
    const onWrapChange = vi.fn();

    await act(async () => {
      root.render(
        <AutoLayoutMatrix
          value={value}
          onFlowChange={onFlowChange}
          onDisplayChange={onDisplayChange}
          onDirectionChange={onDirectionChange}
          onWrapChange={onWrapChange}
          onAlignmentChange={vi.fn()}
          onGapChange={vi.fn()}
          onPaddingChange={vi.fn()}
          onPaddingLinkedChange={vi.fn()}
          onChildSizingChange={vi.fn()}
        />,
      );
    });

    const vertical = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Vertical"]',
    );
    expect(vertical).not.toBeNull();
    await act(async () => vertical?.click());

    expect(onFlowChange).toHaveBeenCalledOnce();
    expect(onFlowChange).toHaveBeenCalledWith("vertical");
    expect(onDisplayChange).not.toHaveBeenCalled();
    expect(onDirectionChange).not.toHaveBeenCalled();
    expect(onWrapChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("treats Grid as a distinct atomic flow and exposes explicit track controls", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onFlowChange = vi.fn();

    await act(async () => {
      root.render(
        <AutoLayoutMatrix
          value={{
            ...value,
            display: "grid",
            grid: {
              columns: 3,
              rows: 2,
              columnSizing: "fill",
              rowSizing: "hug",
              columnGap: 12,
              rowGap: 8,
            },
          }}
          onFlowChange={onFlowChange}
          onDirectionChange={vi.fn()}
          onWrapChange={vi.fn()}
          onAlignmentChange={vi.fn()}
          onGapChange={vi.fn()}
          onGridChange={vi.fn()}
          onPaddingChange={vi.fn()}
          onPaddingLinkedChange={vi.fn()}
          onChildSizingChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[data-flow-value="grid"]')).not.toBeNull();
    expect(
      container.querySelector("[data-grid-track-readout]")?.textContent,
    ).toBe("3 × 2");
    expect(
      container.querySelector('button[aria-label="2 × 1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('input[aria-label="Column gap"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('input[aria-label="Row gap"]'),
    ).not.toBeNull();

    const settings = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid settings"]',
    );
    await act(async () => settings?.click());
    expect(
      document.body.querySelector('input[aria-label="Columns"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('input[aria-label="Rows"]'),
    ).not.toBeNull();

    const grid = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid"]',
    );
    await act(async () => grid?.click());
    expect(onFlowChange).toHaveBeenCalledWith("grid");

    await act(async () => root.unmount());
    container.remove();
  });

  it("maps F and H to the focused width and height sizing fields", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onChildSizingChange = vi.fn();

    await act(async () => {
      root.render(
        <AutoLayoutMatrix
          value={{
            ...value,
            resolvedSize: { horizontal: 320, vertical: 180 },
          }}
          onDirectionChange={vi.fn()}
          onWrapChange={vi.fn()}
          onAlignmentChange={vi.fn()}
          onGapChange={vi.fn()}
          onPaddingChange={vi.fn()}
          onPaddingLinkedChange={vi.fn()}
          onChildSizingChange={onChildSizingChange}
          onChildSizeChange={vi.fn()}
        />,
      );
    });

    const width = container.querySelector<HTMLInputElement>(
      'input[aria-label="W size in pixels"]',
    );
    const height = container.querySelector<HTMLInputElement>(
      'input[aria-label="H size in pixels"]',
    );
    expect(width).not.toBeNull();
    expect(height).not.toBeNull();

    await act(async () => {
      width?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", bubbles: true }),
      );
      height?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "h", bubbles: true }),
      );
    });

    expect(onChildSizingChange).toHaveBeenNthCalledWith(
      1,
      "horizontal",
      "fill",
    );
    expect(onChildSizingChange).toHaveBeenNthCalledWith(2, "vertical", "hug");
    expect(onChildSizingChange).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it("maps A to auto gap on the focused gap field", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onGapModeChange = vi.fn();

    await act(async () => {
      root.render(
        <AutoLayoutMatrix
          value={{ ...value, display: "flex" }}
          onDirectionChange={vi.fn()}
          onWrapChange={vi.fn()}
          onAlignmentChange={vi.fn()}
          onGapChange={vi.fn()}
          onGapModeChange={onGapModeChange}
          onPaddingChange={vi.fn()}
          onPaddingLinkedChange={vi.fn()}
          onChildSizingChange={vi.fn()}
        />,
      );
    });

    const gap = container.querySelector<HTMLInputElement>(
      'input[aria-label="Gap"]',
    );
    expect(gap).not.toBeNull();
    await act(async () => {
      gap?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
    });

    expect(onGapModeChange).toHaveBeenCalledTimes(1);
    expect(onGapModeChange).toHaveBeenCalledWith("auto", "horizontal");

    await act(async () => root.unmount());
    container.remove();
  });

  it("writes linked pairs and Alt-mirrored margin sides", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onMarginChange = vi.fn();

    await act(async () => {
      root.render(
        <AutoLayoutMatrix
          value={{
            ...value,
            margin: { top: 4, right: 4, bottom: 4, left: 4 },
          }}
          showChildLayoutControls
          onDirectionChange={vi.fn()}
          onWrapChange={vi.fn()}
          onAlignmentChange={vi.fn()}
          onGapChange={vi.fn()}
          onPaddingChange={vi.fn()}
          onPaddingLinkedChange={vi.fn()}
          onMarginChange={onMarginChange}
          onChildSizingChange={vi.fn()}
        />,
      );
    });

    const horizontalMargin = container.querySelector<HTMLInputElement>(
      'input[aria-label="Left margin / Right margin"]',
    );
    expect(horizontalMargin).not.toBeNull();
    await act(async () => {
      horizontalMargin?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });

    expect(onMarginChange).toHaveBeenCalledWith(
      { top: 4, right: 5, bottom: 4, left: 5 },
      expect.objectContaining({ source: "keyboard", phase: "commit" }),
      ["left", "right"],
    );

    const unlinkMargin = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Unlink margin sides"]',
    );
    expect(unlinkMargin).not.toBeNull();
    await act(async () => unlinkMargin?.click());

    const topMargin = container.querySelector<HTMLInputElement>(
      'input[aria-label="Top margin"]',
    );
    expect(topMargin).not.toBeNull();
    await act(async () => {
      topMargin?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          altKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onMarginChange).toHaveBeenNthCalledWith(
      2,
      { top: 4.1, right: 4, bottom: 4.1, left: 4 },
      expect.objectContaining({ altKey: true, phase: "commit" }),
      ["top", "bottom"],
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("starts mixed margin selections unlinked", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onMarginChange = vi.fn();

    await act(async () => {
      root.render(
        <AutoLayoutMatrix
          value={{
            ...value,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            marginMixed: { top: true, right: true, bottom: true, left: true },
          }}
          showChildLayoutControls
          onDirectionChange={vi.fn()}
          onWrapChange={vi.fn()}
          onAlignmentChange={vi.fn()}
          onGapChange={vi.fn()}
          onPaddingChange={vi.fn()}
          onPaddingLinkedChange={vi.fn()}
          onMarginChange={onMarginChange}
          onChildSizingChange={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector('button[aria-label="Link margin sides"]'),
    ).not.toBeNull();
    const topMargin = container.querySelector<HTMLInputElement>(
      'input[aria-label="Top margin"]',
    );
    expect(topMargin).not.toBeNull();
    await act(async () => {
      topMargin?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });

    expect(onMarginChange).toHaveBeenCalledWith(
      { top: 1, right: 0, bottom: 0, left: 0 },
      expect.objectContaining({ source: "keyboard", phase: "commit" }),
      ["top"],
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
