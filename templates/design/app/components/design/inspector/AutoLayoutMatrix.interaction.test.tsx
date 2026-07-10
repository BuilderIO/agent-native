// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

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
});
