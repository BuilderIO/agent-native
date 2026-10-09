// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ widget: false }));

vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  useIsMcpAppWidgetEmbed: () => state.widget,
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideStyleSnapshot } from "./slide-style";
import { SlideContextToolbar } from "./SlideContextToolbar";

type ResizeCallback = (
  entries: Array<{ contentRect: { width: number } }>,
) => void;

let toolbarWidth = 0;
let resizeCallbacks: ResizeCallback[] = [];

class FakeResizeObserver {
  constructor(private readonly callback: ResizeCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeCallbacks = resizeCallbacks.filter((cb) => cb !== this.callback);
  }
}

function resizeTo(width: number) {
  toolbarWidth = width;
  act(() => {
    for (const callback of resizeCallbacks) {
      callback([{ contentRect: { width } }]);
    }
  });
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
  render(
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
  return { onArrange, toolbar: screen.getByRole("toolbar") };
}

beforeEach(() => {
  state.widget = false;
  toolbarWidth = 0;
  resizeCallbacks = [];
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

describe("contextual toolbar in a narrow widget pane", () => {
  it("keeps every inline control outside a widget, whatever the width", () => {
    toolbarWidth = 400;
    const { toolbar } = renderToolbar(snapshot());

    expect(toolbar.getAttribute("data-compact")).toBeNull();
    expect(screen.getByLabelText("Opacity")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to back" })).toBeTruthy();
  });

  it("keeps the single scrolling row in a wide widget pane", () => {
    state.widget = true;
    toolbarWidth = 1040;
    const { toolbar } = renderToolbar(snapshot());

    expect(toolbar.getAttribute("data-compact")).toBeNull();
    expect(toolbar.className).not.toContain("flex-wrap");
    expect(screen.getByLabelText("Opacity")).toBeTruthy();
  });

  it("wraps and moves secondary object controls into Controls in a narrow pane", () => {
    state.widget = true;
    toolbarWidth = 400;
    const { toolbar, onArrange } = renderToolbar(snapshot());

    expect(toolbar.getAttribute("data-compact")).toBe("true");
    expect(toolbar.className).toContain("flex-wrap");
    // The fill stays inline; the rest of the appearance moved.
    expect(screen.getByRole("button", { name: /Fill/ })).toBeTruthy();
    expect(screen.queryByLabelText("Opacity")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send to back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Controls" }));

    expect(screen.getByLabelText("Opacity")).toBeTruthy();
    expect(screen.getByLabelText("Corner radius")).toBeTruthy();
    expect(screen.getByLabelText("Stroke weight")).toBeTruthy();
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

  it("returns to the single row when the pane grows", () => {
    state.widget = true;
    toolbarWidth = 400;
    const { toolbar } = renderToolbar(snapshot());
    expect(toolbar.getAttribute("data-compact")).toBe("true");

    resizeTo(900);

    expect(toolbar.getAttribute("data-compact")).toBeNull();
    expect(screen.getByLabelText("Opacity")).toBeTruthy();
  });
});
