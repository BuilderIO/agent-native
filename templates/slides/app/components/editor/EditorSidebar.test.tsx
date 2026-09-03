// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

const sortableKeyDown = vi.hoisted(() => vi.fn());
const scrollIntoView = vi.fn();

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/collab-ui", () => ({
  DEFAULT_AGENT_IDENTITY: { email: "agent@example.com" },
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: { onKeyDown: sortableKeyDown },
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: () => <div data-testid="slide-renderer" />,
}));

vi.mock("@/components/editor/AiEditingMarker", () => ({
  AiEditingMarker: () => null,
}));

vi.mock("@/components/editor/GeneratingSlidePreview", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.resolve({})),
);

Element.prototype.scrollIntoView = scrollIntoView;

import EditorSidebar, { getSlideSelection } from "./EditorSidebar";

afterEach(() => {
  cleanup();
  sortableKeyDown.mockClear();
  scrollIntoView.mockClear();
});

describe("EditorSidebar thumbnail scroll cue", () => {
  it("scrolls an opened slide thumbnail into view", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
    ];
    const { container, rerender } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );

    scrollIntoView.mockClear();
    rerender(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-3"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(
      container.querySelector('[data-slide-thumbnail-id="slide-3"]'),
    );
  });

  it("only marks the thumbnail pane as scrolled after it leaves the top", () => {
    const slide: Slide = {
      id: "slide-1",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const { container } = render(
      <EditorSidebar
        slides={[slide]}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );

    const thumbnailPane = container.querySelector<HTMLElement>(
      "[data-slides-thumbnail-scroll]",
    );
    const thumbnailScrollArea = container.querySelector<HTMLElement>(
      "[data-slides-thumbnail-scroll] > div",
    );
    expect(thumbnailScrollArea?.classList.contains("overflow-x-hidden")).toBe(
      true,
    );
    expect(thumbnailPane?.dataset.slidesThumbnailScroll).toBe("top");

    act(() => {
      if (!thumbnailScrollArea) return;
      thumbnailScrollArea.scrollTop = 24;
      fireEvent.scroll(thumbnailScrollArea);
    });
    expect(thumbnailPane?.dataset.slidesThumbnailScroll).toBe("scrolled");

    act(() => {
      if (!thumbnailScrollArea) return;
      thumbnailScrollArea.scrollTop = 0;
      fireEvent.scroll(thumbnailScrollArea);
    });
    expect(thumbnailPane?.dataset.slidesThumbnailScroll).toBe("top");
  });
});

describe("slide thumbnail selection", () => {
  const slideIds = ["slide-1", "slide-2", "slide-3", "slide-4"];

  it("selects a shift-clicked range from the anchor", () => {
    expect(
      getSlideSelection({
        slideIds,
        selectedSlideIds: ["slide-2"],
        anchorSlideId: "slide-2",
        targetSlideId: "slide-4",
        shiftKey: true,
      }),
    ).toEqual({
      selectedSlideIds: ["slide-2", "slide-3", "slide-4"],
      anchorSlideId: "slide-2",
    });
  });

  it("toggles a cmd/ctrl-clicked slide", () => {
    expect(
      getSlideSelection({
        slideIds,
        selectedSlideIds: ["slide-1", "slide-3"],
        anchorSlideId: "slide-3",
        targetSlideId: "slide-3",
        metaKey: true,
      }).selectedSlideIds,
    ).toEqual(["slide-1"]);
    expect(
      getSlideSelection({
        slideIds,
        selectedSlideIds: ["slide-1"],
        anchorSlideId: "slide-1",
        targetSlideId: "slide-3",
        ctrlKey: true,
      }).selectedSlideIds,
    ).toEqual(["slide-1", "slide-3"]);
  });
});

describe("EditorSidebar arrow navigation", () => {
  it("preserves sortable keyboard activation on the thumbnail", () => {
    const slide: Slide = {
      id: "slide-1",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const { container } = render(
      <EditorSidebar
        slides={[slide]}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-1"]',
    );

    fireEvent.keyDown(thumbnail ?? document, { key: "Enter" });

    expect(sortableKeyDown).toHaveBeenCalledOnce();
  });

  it("moves to the next thumbnail with arrows after a thumbnail click", () => {
    const slideOne: Slide = {
      id: "slide-1",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const slideTwo: Slide = {
      id: "slide-2",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const onSelectSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={[slideOne, slideTwo]}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-1"]',
    );
    thumbnail?.focus();
    onSelectSlide.mockClear();

    fireEvent.keyDown(thumbnail ?? document, { key: "ArrowDown" });

    expect(onSelectSlide).toHaveBeenCalledOnce();
    expect(onSelectSlide).toHaveBeenCalledWith("slide-2");
  });

  it("does not navigate while a slide text block owns the arrow keys", () => {
    const slideOne: Slide = {
      id: "slide-1",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const slideTwo: Slide = {
      id: "slide-2",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const onSelectSlide = vi.fn();
    render(
      <EditorSidebar
        slides={[slideOne, slideTwo]}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const block = document.createElement("div");
    block.contentEditable = "true";
    block.dataset.editingBlock = "true";
    document.body.append(block);
    block.focus();

    fireEvent.keyDown(document, { key: "ArrowDown", shiftKey: true });

    expect(onSelectSlide).not.toHaveBeenCalled();
    block.remove();
  });

  it("leaves arrows available for the selected canvas element to nudge", () => {
    const slideOne: Slide = {
      id: "slide-1",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const slideTwo: Slide = {
      id: "slide-2",
      content: "<div />",
      notes: "",
      layout: "content",
    };
    const onSelectSlide = vi.fn();
    render(
      <EditorSidebar
        slides={[slideOne, slideTwo]}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const selectedCanvas = document.createElement("div");
    selectedCanvas.dataset.slideElementSelected = "true";
    document.body.append(selectedCanvas);

    fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(onSelectSlide).not.toHaveBeenCalled();
    selectedCanvas.remove();
  });
});

describe("slide thumbnail deletion", () => {
  const slides: Slide[] = [
    { id: "slide-1", content: "<div />", notes: "", layout: "content" },
    { id: "slide-2", content: "<div />", notes: "", layout: "content" },
    { id: "slide-3", content: "<div />", notes: "", layout: "content" },
  ];

  it("deletes the focused thumbnail selection, including multiple slides", () => {
    const onDeleteSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        selectedSlideIds={["slide-1", "slide-2"]}
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        onDeleteSlide={onDeleteSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-2"]',
    );
    thumbnail?.focus();

    fireEvent.keyDown(thumbnail ?? document, { key: "Backspace" });

    expect(onDeleteSlide).toHaveBeenCalledOnce();
    expect(onDeleteSlide).toHaveBeenCalledWith(["slide-1", "slide-2"]);
  });

  it("refocuses the next thumbnail after deleting the focused slide", async () => {
    const onDeleteSlide = vi.fn();

    function Harness() {
      const [visibleSlides, setVisibleSlides] = useState(slides);
      const [activeSlideId, setActiveSlideId] = useState("slide-1");
      return (
        <EditorSidebar
          slides={visibleSlides}
          activeSlideId={activeSlideId}
          deckId="deck-1"
          deckTitle="Test deck"
          selectedSlideIds={[activeSlideId]}
          onSelectSlide={setActiveSlideId}
          onDeleteSlide={(slideIds) => {
            onDeleteSlide(slideIds);
            const nextSlides = visibleSlides.filter(
              (slide) => !slideIds.includes(slide.id),
            );
            setVisibleSlides(nextSlides);
            setActiveSlideId(nextSlides[0]?.id ?? "");
          }}
          describeSlideId={null}
          onCloseDescribe={() => {}}
          addSlideAgentSubmit={() => {}}
        />
      );
    }

    const { container } = render(<Harness />);
    const firstThumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-1"]',
    );
    firstThumbnail?.focus();

    fireEvent.keyDown(firstThumbnail ?? document, { key: "Delete" });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector('[data-slide-thumbnail-id="slide-2"]'),
      );
    });
    expect(onDeleteSlide).toHaveBeenCalledWith(["slide-1"]);
  });

  it("does not delete a read-only thumbnail", () => {
    const onDeleteSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        readOnly
        onSelectSlide={() => {}}
        onDeleteSlide={onDeleteSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-1"]',
    );

    fireEvent.keyDown(thumbnail ?? document, { key: "Delete" });

    expect(onDeleteSlide).not.toHaveBeenCalled();
  });
});
