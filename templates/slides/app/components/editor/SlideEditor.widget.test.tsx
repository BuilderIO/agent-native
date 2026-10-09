// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

const deckSlides = [
  { ...slide, id: "slide-before" },
  slide,
  { ...slide, id: "slide-next" },
  { ...slide, id: "slide-last" },
] as Slide[];

function renderEditor(
  readOnly = false,
  extra: {
    deckSlides?: Slide[];
    onSelectFollowingSlide?: (slideId: string) => void;
  } = {},
) {
  const noop = () => {};
  return render(
    <SlideEditor
      slide={slide}
      readOnly={readOnly}
      {...extra}
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

  it("shows the slide and editing toolbar without speaker notes in a writable widget", () => {
    widget.embed = true;
    const { container } = renderEditor();

    expect(container.querySelector(".slide-content")).not.toBeNull();
    expect(
      container.querySelector("[data-slide-context-toolbar]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-editable='true']")).not.toBeNull();
    expect(screen.queryByText("raw.speakerNotes")).toBeNull();
  });

  it("keeps a read-only widget free of editing controls", () => {
    widget.embed = true;
    const { container } = renderEditor(true);

    expect(container.querySelector("[data-slide-context-toolbar]")).toBeNull();
    expect(container.querySelector("[data-editable='true']")).toBeNull();
  });

  it("keeps the toolbar and speaker notes outside a widget", () => {
    const { container } = renderEditor();

    expect(
      container.querySelector("[data-slide-context-toolbar]"),
    ).not.toBeNull();
    expect(screen.getByText("raw.speakerNotes")).toBeTruthy();
  });

  it.each([320, 524, 768, 1004])(
    "scales the slide to a %s px widget pane",
    (width) => {
      widget.embed = true;
      stubViewport(width, 860);
      const { container } = renderEditor(true);
      expect(canvasWidth(container)).toBe(`${width}px`);
    },
  );

  it("stacks the slides after the current one below it at the same width", () => {
    widget.embed = true;
    stubViewport(524, 860);
    const onSelectFollowingSlide = vi.fn();
    const { container } = renderEditor(true, {
      deckSlides,
      onSelectFollowingSlide,
    });

    const stack = container.querySelector<HTMLElement>(
      "[data-following-slides='true']",
    )!;
    expect(stack.style.width).toBe(canvasWidth(container));
    expect(
      Array.from(stack.querySelectorAll("[data-following-slide-id]")).map(
        (item) => item.getAttribute("data-following-slide-id"),
      ),
    ).toEqual(["slide-next", "slide-last"]);

    fireEvent.click(
      stack.querySelector("[data-following-slide-id='slide-last']")!,
    );
    expect(onSelectFollowingSlide).toHaveBeenCalledWith("slide-last");
  });

  it("renders following slide previews only near the visible pane", async () => {
    widget.embed = true;
    const observedTargets: Element[] = [];
    let observer: {
      callback: IntersectionObserverCallback;
      disconnect: () => void;
      observe: (target: Element) => void;
    } | null = null;
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observer = {
          callback,
          disconnect: () => undefined,
          observe: (target) => observedTargets.push(target),
        };
      }
      disconnect() {}
      observe(target: Element) {
        if (target.hasAttribute("data-following-slide-id")) {
          observedTargets.push(target);
        }
      }
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

    const largeDeck = [
      slide,
      ...Array.from({ length: 19 }, (_, index) => ({
        ...slide,
        id: `slide-${index}`,
      })),
    ] as Slide[];
    const { container } = renderEditor(true, {
      deckSlides: largeDeck,
      onSelectFollowingSlide: vi.fn(),
    });
    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>("[data-following-slide-id]"),
    );

    expect(buttons).toHaveLength(19);
    expect(observedTargets).toHaveLength(19);
    expect(
      buttons
        .slice(0, 3)
        .every((button) => button.querySelector(".slide-content")),
    ).toBe(true);
    expect(
      buttons
        .slice(3)
        .every((button) => !button.querySelector(".slide-content")),
    ).toBe(true);

    const newlyVisible = buttons[12]!;
    await act(async () => {
      observer?.callback(
        [
          {
            target: newlyVisible,
            isIntersecting: true,
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
    });

    expect(newlyVisible.querySelector(".slide-content")).not.toBeNull();
  });

  it("starts a newly selected slide at the top of the pane", () => {
    widget.embed = true;
    const props = {
      readOnly: true,
      onUpdateSlide: () => undefined,
      onGenerateImage: () => {},
      onOpenAssetLibrary: () => {},
      onUploadImage: () => {},
      onToggleObjectFit: () => {},
      onChangeObjectPosition: () => {},
    };
    const { container, rerender } = render(
      <SlideEditor {...props} slide={slide} />,
      { wrapper: Providers },
    );
    const scroller = container.querySelector<HTMLElement>(".overflow-auto")!;
    scroller.scrollTop = 320;

    rerender(<SlideEditor {...props} slide={deckSlides[2]} />);

    expect(scroller.scrollTop).toBe(0);
  });

  it("shows no stack after the last slide of the deck", () => {
    widget.embed = true;
    const { container } = renderEditor(true, {
      deckSlides: [deckSlides[0], slide],
      onSelectFollowingSlide: vi.fn(),
    });

    expect(container.querySelector("[data-following-slides]")).toBeNull();
  });

  it("never stacks following slides outside a widget", () => {
    const { container } = renderEditor(false, {
      deckSlides,
      onSelectFollowingSlide: vi.fn(),
    });

    expect(container.querySelector("[data-following-slides]")).toBeNull();
  });

  it("still caps a normal editor at 100% instead of scaling up", () => {
    stubViewport(1004, 860);
    const { container } = renderEditor();

    expect(canvasWidth(container)).toBe("960px");
  });
});
