// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideStyleSnapshot } from "./slide-style";
import { SlideContextToolbar } from "./SlideContextToolbar";

function textSnapshot(
  overrides: Partial<SlideStyleSnapshot> = {},
): SlideStyleSnapshot {
  return {
    selector: '[data-slide-object-id="object-a"]',
    label: "Heading",
    tagName: "H2",
    textPreview: "Heading",
    isText: true,
    isImage: false,
    isAbsolute: true,
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    rotation: 0,
    slideWidth: 1280,
    slideHeight: 720,
    color: "#ffffff",
    fontFamily: "'Poppins', sans-serif",
    backgroundColor: "transparent",
    fontSize: 40,
    fontWeight: "700",
    fontStyle: "normal",
    textDecoration: "none",
    listKind: null,
    lineHeight: 1.2,
    textAlign: "left",
    opacity: 100,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "#000000",
    paddingX: 0,
    paddingY: 0,
    zIndex: 1,
    ...overrides,
  };
}

describe("contextual toolbar controls panel layout", () => {
  afterEach(cleanup);

  it("lets each numeric input fill its grid cell and gives the size row room for the link button", () => {
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={textSnapshot()}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Controls" });
    fireEvent.click(trigger);

    const gridOf = (label: string) => {
      const cells = screen.getAllByLabelText(label);
      const grid = cells[cells.length - 1]?.closest('[class*="grid-cols"]');
      if (!grid) throw new Error(`no grid around ${label}`);
      return grid;
    };
    const size = gridOf("Width");
    expect(size.className).toContain("grid-cols-[1fr_auto_1fr]");
    expect(size.className).toContain("[&>div]:w-full");
    for (const label of ["X", "Opacity"]) {
      expect(gridOf(label).className).toContain("[&>div]:w-full");
    }
  });
});
