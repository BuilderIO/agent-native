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

function renderToolbar(
  snapshot: SlideStyleSnapshot,
  onChange = vi.fn<(patch: unknown) => void>(),
) {
  render(
    <TooltipProvider>
      <SlideContextToolbar
        snapshot={snapshot}
        background="#000000"
        onChange={onChange}
        onBackgroundChange={vi.fn()}
      />
    </TooltipProvider>,
  );
  return onChange;
}

describe("contextual toolbar emphasis toggles", () => {
  afterEach(cleanup);

  it("turns italic on for text that is not italic", () => {
    const onChange = renderToolbar(textSnapshot());

    fireEvent.click(screen.getByRole("button", { name: "Italic" }));

    expect(onChange).toHaveBeenCalledWith({ fontStyle: "italic" });
  });

  it("turns italic back off, so the button is a toggle rather than a setter", () => {
    const onChange = renderToolbar(textSnapshot({ fontStyle: "italic" }));

    const button = screen.getByRole("button", { name: "Italic" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledWith({ fontStyle: "normal" });
  });

  it("toggles underline independently of other decorations", () => {
    const onChange = renderToolbar(
      textSnapshot({ textDecoration: "underline line-through" }),
    );

    const button = screen.getByRole("button", { name: "Underline" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);

    // Only the underline token is removed. A bare "none" here would also drop
    // the line-through the user never asked to change.
    expect(onChange).toHaveBeenCalledWith({ textDecoration: "line-through" });
  });

  it("adds underline without dropping a decoration already present", () => {
    const onChange = renderToolbar(
      textSnapshot({ textDecoration: "line-through" }),
    );

    const button = screen.getByRole("button", { name: "Underline" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledWith({
      textDecoration: "line-through underline",
    });
  });

  it("clears the decoration entirely when underline was the only one", () => {
    const onChange = renderToolbar(
      textSnapshot({ textDecoration: "underline" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Underline" }));

    expect(onChange).toHaveBeenCalledWith({ textDecoration: "none" });
  });

  it("reads a mixed selection as off so one click makes it consistent", () => {
    const onChange = renderToolbar(
      textSnapshot({
        fontStyle: "italic",
        mixedTextStyles: ["fontStyle"],
      }),
    );

    const button = screen.getByRole("button", { name: "Italic" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledWith({ fontStyle: "italic" });
  });

  it("offers no emphasis toggles for a non-text object", () => {
    renderToolbar(textSnapshot({ isText: false, isImage: true }));

    expect(screen.queryByRole("button", { name: "Italic" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Underline" })).toBeNull();
  });
});
