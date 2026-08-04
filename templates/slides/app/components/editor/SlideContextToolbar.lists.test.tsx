// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { SlideContextToolbar } from "./SlideContextToolbar";
import type { SlideStyleSnapshot } from "./slide-style";

function textSnapshot(
  overrides: Partial<SlideStyleSnapshot> = {},
): SlideStyleSnapshot {
  return {
    selector: '[data-slide-object-id="object-a"]',
    label: "Body",
    tagName: "DIV",
    textPreview: "Water weekly",
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
    backgroundColor: "transparent",
    fontSize: 24,
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "none",
    listKind: null,
    lineHeight: 1.4,
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

function renderToolbar(snapshot: SlideStyleSnapshot, onToggleList = vi.fn()) {
  render(
    <TooltipProvider>
      <SlideContextToolbar
        snapshot={snapshot}
        background="#000000"
        onChange={vi.fn()}
        onBackgroundChange={vi.fn()}
        onToggleList={onToggleList}
      />
    </TooltipProvider>,
  );
  return onToggleList;
}

describe("contextual toolbar list toggles", () => {
  afterEach(cleanup);

  it("asks for a bulleted list", () => {
    const onToggleList = renderToolbar(textSnapshot());

    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));

    expect(onToggleList).toHaveBeenCalledWith("bullet");
  });

  it("asks for a numbered list", () => {
    const onToggleList = renderToolbar(textSnapshot());

    fireEvent.click(screen.getByRole("button", { name: "Numbered list" }));

    expect(onToggleList).toHaveBeenCalledWith("ordered");
  });

  it("shows which kind the object already is", () => {
    renderToolbar(textSnapshot({ listKind: "ordered" }));

    expect(
      screen
        .getByRole("button", { name: "Numbered list" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Bullet list" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("offers no list toggles for a non-text object", () => {
    renderToolbar(textSnapshot({ isText: false, isImage: true }));

    expect(screen.queryByRole("button", { name: "Bullet list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Numbered list" })).toBeNull();
  });

  it("hides the toggles when the host cannot convert lists", () => {
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

    expect(screen.queryByRole("button", { name: "Bullet list" })).toBeNull();
  });
});
