// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ widget: false }));

vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  useIsMcpAppWidgetEmbed: () => state.widget,
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideStyleSnapshot } from "./slide-style";
import { SlideContextToolbar } from "./SlideContextToolbar";

let toolbarWidth = 0;

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function snapshot(
  overrides: Partial<SlideStyleSnapshot> = {},
): SlideStyleSnapshot {
  return {
    selector: '[data-slide-object-id="object-a"]',
    label: "Object",
    tagName: "DIV",
    textPreview: "Object",
    isText: false,
    isImage: false,
    isAbsolute: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    slideWidth: 1280,
    slideHeight: 720,
    color: "#000000",
    fontFamily: "sans-serif",
    backgroundColor: "#ffffff",
    fontSize: 16,
    fontWeight: "400",
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

function renderToolbar(style: SlideStyleSnapshot) {
  const onArrange = vi.fn();
  const view = render(
    <TooltipProvider>
      <SlideContextToolbar
        snapshot={style}
        background="#000000"
        onArrange={onArrange}
        onChange={vi.fn()}
        onBackgroundChange={vi.fn()}
      />
    </TooltipProvider>,
  );
  return { onArrange, toolbar: screen.getByRole("toolbar"), view };
}

// React's generated ids differ between two renders of the same tree.
const stableMarkup = (html: string) =>
  html.replace(/«r[0-9a-z]+»|_r_[0-9a-z]+_|:r[0-9a-z]+:/g, "id");

beforeEach(() => {
  state.widget = false;
  toolbarWidth = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width: toolbarWidth }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("contextual toolbar in a widget pane", () => {
  it.each([400, 1040])(
    "renders the same toolbar as the app at %s px",
    (width) => {
      toolbarWidth = width;
      const standard = stableMarkup(
        renderToolbar(snapshot()).toolbar.outerHTML,
      );
      cleanup();

      state.widget = true;
      const embedded = stableMarkup(
        renderToolbar(snapshot()).toolbar.outerHTML,
      );

      expect(embedded).toBe(standard);
    },
  );

  it("keeps every inline control in a narrow widget pane", () => {
    state.widget = true;
    toolbarWidth = 400;
    const { toolbar, onArrange } = renderToolbar(snapshot());

    expect(toolbar.getAttribute("data-compact")).toBeNull();
    expect(toolbar.className).not.toContain("flex-wrap");
    expect(screen.getByLabelText("Opacity")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send to back" }));
    expect(onArrange).toHaveBeenCalledWith("back");
  });

  it("keeps the primary text controls inline in a narrow pane", () => {
    state.widget = true;
    toolbarWidth = 400;
    renderToolbar(snapshot({ isText: true, tagName: "H1" }));

    for (const name of [
      "Font family",
      "Weight",
      "Italic",
      "Underline",
      "Text color",
      "Align",
    ]) {
      expect(screen.getAllByLabelText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText("Size")).toBeTruthy();
  });
});
