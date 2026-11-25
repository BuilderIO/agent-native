// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
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

function renderToolbar(snapshot: SlideStyleSnapshot) {
  render(
    <TooltipProvider>
      <SlideContextToolbar
        snapshot={snapshot}
        background="#000000"
        onChange={vi.fn()}
        onBackgroundChange={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("contextual toolbar width and height fields", () => {
  afterEach(cleanup);

  it("shows a three-digit size without the px suffix and with tight padding", () => {
    renderToolbar(
      textSnapshot({
        isText: false,
        tagName: "DIV",
        width: 375,
        height: 120,
      }),
    );

    for (const [label, shown] of [
      ["Width", "375"],
      ["Height", "120"],
    ] as const) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.value).toBe(shown);
      expect(input.className).toContain("px-1.5");
    }
  });
});
