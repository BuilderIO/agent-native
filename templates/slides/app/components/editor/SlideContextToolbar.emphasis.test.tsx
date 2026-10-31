import type { DesignSystemData } from "@shared/api";
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

const designSystemWithHeadings: DesignSystemData = {
  colors: {
    primary: "#2457D6",
    secondary: "#C85C3A",
    accent: "#2457D6",
    background: "#FFFFFF",
    surface: "#FFFFFF",
    text: "#1F2933",
    textMuted: "#667085",
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingWeight: "700",
    bodyWeight: "400",
    headingSizes: { h1: "56px", h2: "34px", h3: "1.5rem" },
  },
  spacing: { slidePadding: "64px", elementGap: "16px" },
  borders: { radius: "12px", accentWidth: "3px" },
  slideDefaults: { background: "#FFFFFF", labelStyle: "none" },
  logos: [],
};

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

describe("contextual toolbar font size field", () => {
  afterEach(cleanup);

  it("has no stepper buttons and commits a size picked from the scale", () => {
    const onChange = renderToolbar(textSnapshot({ fontSize: 40 }));

    expect(screen.queryByRole("button", { name: /decrease/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /increase/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Font sizes" }));
    const current = screen
      .getAllByRole("option")
      .find((option) => option.getAttribute("data-current") === "true");
    if (!current) throw new Error("current size is not in the list");
    expect(current.textContent).toBe("40");
    fireEvent.click(screen.getByRole("option", { name: "64" }));

    expect(onChange).toHaveBeenCalledWith({ fontSize: "64px" });
  });

  it("lists the deck's heading sizes below the scale", () => {
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={textSnapshot({ fontSize: 56 })}
          background="#000000"
          designSystem={designSystemWithHeadings}
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Font sizes" }));
    const options = screen.getAllByRole("option");
    const heading = options.find((option) =>
      /^Heading ?156$/.test(option.textContent),
    );
    if (!heading) throw new Error("missing heading size");

    expect(screen.getByText(/^Deck/)).toBeTruthy();
    // A rem heading size has no single pixel value to list.
    expect(screen.queryByRole("option", { name: /^Heading ?3/ })).toBeNull();
    // 56 is not on the shared scale, so it is pinned above the list as current.
    expect(options.at(0)?.textContent).toBe("56");
    expect(options.at(0)?.getAttribute("data-current")).toBe("true");
  });

  it("steps a mixed selection from the block size to the next size on the scale", () => {
    const onChange = renderToolbar(
      textSnapshot({ fontSize: 40, mixedTextStyles: ["fontSize"] }),
    );
    const input = screen.getByLabelText<HTMLInputElement>("Size");

    expect(input.value).toBe("Mixed");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(onChange).toHaveBeenCalledWith({ fontSize: "48px" });
  });

  it("writes a typed size on Enter", () => {
    const onChange = renderToolbar(textSnapshot({ fontSize: 40 }));
    const input = screen.getByLabelText<HTMLInputElement>("Size");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "39" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({ fontSize: "39px" });
  });
});

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

  it("marks the portalled align menu as an inline-edit surface", () => {
    renderToolbar(textSnapshot());

    for (const name of ["Align"]) {
      const trigger = screen.getByRole("button", { name });
      fireEvent.pointerDown(trigger, { button: 0 });
      fireEvent.pointerUp(trigger, { button: 0 });

      const menu = screen.getByRole("menu");
      expect(menu.closest("[data-slide-inline-edit-surface]")).toBeTruthy();

      fireEvent.keyDown(menu, { key: "Escape" });
    }
  });
});

describe("contextual toolbar font family", () => {
  afterEach(cleanup);

  it("applies the selected font family to the text selection", () => {
    const onChange = renderToolbar(textSnapshot());
    const trigger = screen.getByRole("button", { name: "Font family" });

    fireEvent.click(trigger);
    expect(
      screen.getByRole("listbox").closest("[data-slide-inline-edit-surface]"),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Inter" },
    });
    fireEvent.click(screen.getByRole("option", { name: "Inter" }));

    expect(onChange).toHaveBeenCalledWith({
      fontFamily: "'Inter', sans-serif",
    });
  });

  it("sorts an unknown current font with the built-in families", () => {
    renderToolbar(textSnapshot({ fontFamily: "'Brand Sans', sans-serif" }));

    fireEvent.click(screen.getByRole("button", { name: "Font family" }));

    const labels = screen
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());
    expect(labels.indexOf("Default")).toBeLessThan(
      labels.indexOf("Brand Sans"),
    );
    // Built-ins and the current unknown font come before the font library.
    expect(labels.indexOf("Brand Sans")).toBeLessThan(
      labels.indexOf("Abril Fatface"),
    );
  });
});
