// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client", () => ({
  cn: (...inputs: Array<string | false | null | undefined>) =>
    inputs.filter(Boolean).join(" "),
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: ({ children }: { children?: unknown }) => children as never,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import type { ElementInfo } from "../types";
import { LayoutContextProperties } from "./layout-properties";

describe("LayoutContextProperties interactions", () => {
  it("commits Grid atomically while preserving authored custom tracks", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const customColumns = "96px 1fr minmax(80px, 2fr)";
    const customRows = "repeat(2, max-content)";
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "96px 180px 180px",
        gridTemplateRows: "24px 24px",
        gridAutoFlow: "row",
        columnGap: "12px",
        rowGap: "8px",
        width: "480px",
        height: "100px",
      },
      inlineStyles: {
        gridTemplateColumns: customColumns,
        gridTemplateRows: customRows,
        gridAutoFlow: "row",
      },
      boundingRect: { x: 0, y: 0, width: 480, height: 100 },
      isFlexChild: false,
      isFlexContainer: false,
      isGridContainer: true,
      childElementCount: 4,
      sourceId: "grid-1",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties
          element={element}
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
        />,
      );
    });

    const gridButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Grid"]',
    );
    expect(gridButton?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => gridButton?.click());
    expect(onStylesChange).toHaveBeenCalledOnce();
    expect(onStylesChange).toHaveBeenCalledWith({
      display: "grid",
      gridTemplateColumns: customColumns,
      gridTemplateRows: customRows,
      gridAutoFlow: "row",
    });
    expect(onStyleChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("links asymmetric padding without mutating or averaging authored values", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    const element = {
      tagName: "div",
      classes: [],
      computedStyles: {
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        width: "200px",
        height: "100px",
        paddingTop: "4px",
        paddingRight: "8px",
        paddingBottom: "12px",
        paddingLeft: "16px",
      },
      boundingRect: { x: 0, y: 0, width: 200, height: 100 },
      isFlexChild: false,
      isFlexContainer: true,
      childElementCount: 1,
      sourceId: "frame-1",
    } as ElementInfo;

    await act(async () => {
      root.render(
        <LayoutContextProperties
          element={element}
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
        />,
      );
    });

    const linkButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Link padding"]',
    );
    expect(linkButton).not.toBeNull();
    await act(async () => linkButton?.click());

    expect(onStyleChange).not.toHaveBeenCalled();
    expect(onStylesChange).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[aria-label="Unlink padding"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
