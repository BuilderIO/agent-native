// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";

import SlideEditor from "./SlideEditor";

const widget = vi.hoisted(() => ({ embed: false }));

vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => widget.embed,
}));
vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({
    enabled: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useT: () => (key: string) => key,
}));
vi.mock("@/components/deck/ExcalidrawSlide", () => ({
  ExcalidrawSlide: () => <div data-excalidraw-canvas="true" />,
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: (json?: string) => (json ? JSON.parse(json) : null),
}));
vi.mock("@/root", () => ({ enterSelectionMode: vi.fn() }));

const slide = {
  id: "slide-widget",
  content: '<div class="fmd-slide"><h2>Title</h2><p>Caption</p></div>',
  layout: "blank",
} as Slide;

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

function renderEditor(readOnly = false) {
  const noop = () => {};
  return render(
    <SlideEditor
      slide={slide}
      readOnly={readOnly}
      onUpdateSlide={() => undefined}
      onGenerateImage={noop}
      onOpenAssetLibrary={noop}
      onUploadImage={noop}
      onToggleObjectFit={noop}
      onChangeObjectPosition={noop}
    />,
    { wrapper: Providers },
  );
}

function canvasWidth(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    "[data-main-slide-canvas='true']",
  )!.style.width;
}

function stubViewport(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
    height,
  );
}

describe("SlideEditor inside an MCP App widget", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    widget.embed = false;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only the slide: no toolbar row and no speaker-notes strip", () => {
    widget.embed = true;
    const { container } = renderEditor();

    expect(container.querySelector(".slide-content")).not.toBeNull();
    expect(container.querySelector("[data-slide-context-toolbar]")).toBeNull();
    expect(screen.queryByText("raw.speakerNotes")).toBeNull();
  });

  it("keeps the toolbar and speaker notes outside a widget", () => {
    const { container } = renderEditor();

    expect(
      container.querySelector("[data-slide-context-toolbar]"),
    ).not.toBeNull();
    expect(screen.getByText("raw.speakerNotes")).toBeTruthy();
  });

  it("scales the slide up or down to span the pane width next to the rail", () => {
    widget.embed = true;
    stubViewport(1004, 860);
    const wide = renderEditor(true);
    expect(canvasWidth(wide.container)).toBe("1004px");
    wide.unmount();

    stubViewport(524, 860);
    const narrow = renderEditor(true);
    expect(canvasWidth(narrow.container)).toBe("524px");
  });

  it("still caps a normal editor at 100% instead of scaling up", () => {
    stubViewport(1004, 860);
    const { container } = renderEditor();

    expect(canvasWidth(container)).toBe("960px");
  });
});
