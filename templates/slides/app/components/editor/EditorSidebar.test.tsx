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
const sortableState = vi.hoisted(() => ({
  isDragging: false,
  transform: null as {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  } | null,
}));
const scrollIntoView = vi.fn();
const appState = vi.hoisted(() => ({
  write: vi.fn(() => Promise.resolve(null)),
  delete: vi.fn(() => Promise.resolve()),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  deleteClientAppState: appState.delete,
  getBrowserTabId: () => "test-tab",
  useAvatarUrl: () => null,
  writeClientAppState: appState.write,
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
    transform: sortableState.transform,
    transition: undefined,
    isDragging: sortableState.isDragging,
  }),
  verticalListSortingStrategy: {},
}));

const thumbnailRenders = vi.hoisted(() => [] as string[]);

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: { id: string } }) => {
    thumbnailRenders.push(slide.id);
    return <div data-testid="slide-renderer" />;
  },
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

import EditorSidebar, {
  getSlideSelection,
  isContiguousSlideSelection,
  selectionFollowingActiveSlide,
} from "./EditorSidebar";

afterEach(() => {
  cleanup();
  sortableKeyDown.mockClear();
  sortableState.isDragging = false;
  sortableState.transform = null;
  scrollIntoView.mockClear();
  appState.write.mockClear();
  appState.delete.mockClear();
  thumbnailRenders.length = 0;
});

describe("EditorSidebar slides header", () => {
  it("shows the empty state and wires the header New slide button", () => {
    const onAddSlide = vi.fn();
    const { getByLabelText, getByText } = render(
      <EditorSidebar
        slides={[]}
        activeSlideId=""
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        onAddSlide={onAddSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );

    getByText("editorSidebar.emptyTitle");
    fireEvent.click(getByLabelText("editorSidebar.newSlide"));
    expect(onAddSlide).toHaveBeenCalledTimes(1);
  });
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

  it("keeps the source thumbnail in place for an Alt-drag preview", () => {
    sortableState.isDragging = true;
    sortableState.transform = { x: 48, y: 24, scaleX: 1, scaleY: 1 };
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
        altDragSlideId="slide-1"
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

    expect(thumbnail?.parentElement?.style.transform).toBe("");
    expect(thumbnail?.parentElement?.style.opacity).toBe("1");
  });
});

describe("full-width filmstrip", () => {
  it("numbers each slide beside its thumbnail, not on it", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
    ];
    const { container } = render(
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

    expect(container.firstElementChild?.className).toContain("w-full");
    expect(
      container.querySelector(
        '[data-slide-thumbnail-id="slide-2"] [data-slide-thumbnail-frame]',
      )?.textContent,
    ).not.toContain("2");
  });
});

describe("slide thumbnail selection", () => {
  const slideIds = ["slide-1", "slide-2", "slide-3", "slide-4"];

  it("outlines the active thumbnail blue without changing its layout", () => {
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
    const frame = container.querySelector<HTMLElement>(
      "[data-slide-thumbnail-frame]",
    );

    expect(frame?.classList.contains("border")).toBe(true);
    expect(frame?.style.borderColor.toLowerCase()).toBe("#609ff8");
    expect(frame?.style.boxShadow.toLowerCase()).toContain("2px");
    expect(
      container
        .querySelector('[data-slide-thumbnail-id="slide-1"]')
        ?.getAttribute("aria-current"),
    ).toBe("true");
  });

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

  it("identifies only adjacent thumbnail selections as contiguous", () => {
    expect(isContiguousSlideSelection(slideIds, ["slide-1", "slide-2"])).toBe(
      true,
    );
    expect(isContiguousSlideSelection(slideIds, ["slide-1", "slide-3"])).toBe(
      false,
    );
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

  it("moves a focused slide with the platform-primary arrow shortcut", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
    ];
    const onReorderSlides = vi.fn();
    const onSelectSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        onReorderSlides={onReorderSlides}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-2"]',
    );
    thumbnail?.focus();
    onSelectSlide.mockClear();

    fireEvent.keyDown(thumbnail ?? document, {
      key: "ArrowUp",
      metaKey: true,
    });

    expect(onReorderSlides).toHaveBeenCalledWith("slide-2", "slide-1", [
      "slide-2",
    ]);
    expect(onSelectSlide).not.toHaveBeenCalled();
    expect(sortableKeyDown).not.toHaveBeenCalled();
  });

  it("moves a selected slide range to a deck boundary with Shift", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
    ];
    const onReorderSlides = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        selectedSlideIds={["slide-1", "slide-2"]}
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        onReorderSlides={onReorderSlides}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-2"]',
    );

    fireEvent.keyDown(thumbnail ?? document, {
      key: "ArrowDown",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(onReorderSlides).toHaveBeenCalledWith("slide-2", "slide-3", [
      "slide-1",
      "slide-2",
    ]);
  });

  it("moves only the focused slide for a non-contiguous selection", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
      { id: "slide-4", content: "<div />", notes: "", layout: "content" },
    ];
    const onReorderSlides = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-3"
        selectedSlideIds={["slide-1", "slide-3"]}
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        onReorderSlides={onReorderSlides}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-3"]',
    );
    thumbnail?.focus();

    fireEvent.keyDown(thumbnail ?? document, {
      key: "ArrowUp",
      metaKey: true,
    });

    expect(onReorderSlides).toHaveBeenCalledExactlyOnceWith(
      "slide-3",
      "slide-2",
      ["slide-3"],
    );
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

  it("extends the slide selection with Shift+Arrow from the focused thumbnail", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
    ];
    const onSelectSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
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

    fireEvent.keyDown(thumbnail ?? document, {
      key: "ArrowDown",
      shiftKey: true,
    });

    expect(onSelectSlide).toHaveBeenCalledExactlyOnceWith("slide-2", {
      shiftKey: true,
    });
    expect(sortableKeyDown).toHaveBeenCalledOnce();
  });

  it("extends slide selection with Shift+Arrow from the document shortcut", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
    ];
    const onSelectSlide = vi.fn();
    render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowDown", shiftKey: true });

    expect(onSelectSlide).toHaveBeenCalledExactlyOnceWith("slide-2", {
      shiftKey: true,
    });
  });

  it.each([
    ["Home", "slide-1"],
    ["End", "slide-3"],
    ["PageUp", "slide-1"],
    ["PageDown", "slide-3"],
  ])("navigates the filmstrip with %s", (key, targetSlideId) => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
    ];
    const onSelectSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-2"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-2"]',
    );
    thumbnail?.focus();
    onSelectSlide.mockClear();

    fireEvent.keyDown(thumbnail ?? document, { key });

    expect(onSelectSlide).toHaveBeenCalledExactlyOnceWith(targetSlideId);
  });

  it.each([
    ["Home", "slide-1"],
    ["End", "slide-3"],
  ])("extends the selection with Shift+%s to %s", (key, targetSlideId) => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
      { id: "slide-3", content: "<div />", notes: "", layout: "content" },
    ];
    const onSelectSlide = vi.fn();
    const { container } = render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-2"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const thumbnail = container.querySelector<HTMLButtonElement>(
      '[data-slide-thumbnail-id="slide-2"]',
    );
    thumbnail?.focus();
    onSelectSlide.mockClear();

    fireEvent.keyDown(thumbnail ?? document, { key, shiftKey: true });

    expect(onSelectSlide).toHaveBeenCalledExactlyOnceWith(targetSlideId, {
      shiftKey: true,
    });
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

  it.each([
    [
      "menu",
      '<div role="menu"><div role="menuitem" tabindex="-1"></div></div>',
    ],
    [
      "listbox",
      '<div role="listbox"><div role="option" tabindex="-1"></div></div>',
    ],
    ["slider", '<span role="slider" tabindex="0"></span>'],
    [
      "tree",
      '<div role="tree"><div role="treeitem" tabindex="-1"></div></div>',
    ],
    ["dialog", '<div role="dialog"><button type="button"></button></div>'],
    [
      "radix popper",
      '<div data-radix-popper-content-wrapper=""><button type="button"></button></div>',
    ],
  ])("leaves arrows to a focused %s", (_role, markup) => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
    ];
    const onSelectSlide = vi.fn();
    render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = markup;
    document.body.append(host);
    const target = host.querySelector<HTMLElement>("[tabindex], button");
    if (!target) throw new Error("Expected a focusable widget");
    target.focus();

    fireEvent.keyDown(target, { key: "ArrowDown" });

    expect(onSelectSlide).not.toHaveBeenCalled();
    host.remove();
  });

  it("ignores arrows another handler already consumed", () => {
    const slides: Slide[] = [
      { id: "slide-1", content: "<div />", notes: "", layout: "content" },
      { id: "slide-2", content: "<div />", notes: "", layout: "content" },
    ];
    const onSelectSlide = vi.fn();
    render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={onSelectSlide}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );
    const button = document.createElement("button");
    button.addEventListener("keydown", (event) => event.preventDefault());
    document.body.append(button);

    fireEvent.keyDown(button, { key: "ArrowDown" });

    expect(onSelectSlide).not.toHaveBeenCalled();
    button.remove();
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

describe("deck fit state", () => {
  it("clears this tab's fit checks through application state on unmount", () => {
    const { unmount } = render(
      <EditorSidebar
        slides={[]}
        activeSlideId=""
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />,
    );

    unmount();

    expect(appState.delete.mock.calls).toEqual([
      [
        "deck-fit-checks:test-tab",
        { keepalive: true, requestSource: "test-tab" },
      ],
      ["deck-fit-checks", { keepalive: true, requestSource: "test-tab" }],
    ]);
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

describe("thumbnail rendering cost", () => {
  const slides: Slide[] = Array.from({ length: 6 }, (_, index) => ({
    id: `slide-${index + 1}`,
    content: `<p>${index + 1}</p>`,
    notes: "",
    layout: "content",
  }));

  function Rail({ deck }: { deck: Slide[] }) {
    return (
      <EditorSidebar
        slides={deck}
        activeSlideId="slide-1"
        deckId="deck-1"
        deckTitle="Test deck"
        // A new handler every render, as an editor parent passes it.
        onSelectSlide={(slideId) => void slideId}
        onCutSlide={() => {}}
        onDeleteSlide={() => {}}
        onReorderSlides={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
      />
    );
  }

  it("re-renders only the edited slide's thumbnail for a single-slide edit", () => {
    const { rerender } = render(<Rail deck={slides} />);
    expect(new Set(thumbnailRenders)).toEqual(
      new Set(slides.map((slide) => slide.id)),
    );
    thumbnailRenders.length = 0;

    const nudged = slides.map((slide) =>
      slide.id === "slide-3"
        ? { ...slide, content: '<p style="left: 1px">3</p>' }
        : slide,
    );
    rerender(<Rail deck={nudged} />);

    expect(thumbnailRenders).toEqual(["slide-3"]);
  });

  it("renders real thumbnails only for slides near the rail's viewport", () => {
    let report: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      },
    );
    try {
      const { container } = render(<Rail deck={slides} />);
      expect(observed).toHaveLength(slides.length);

      act(() => {
        report(
          observed.map((target, index) => ({
            target,
            isIntersecting: index === 4,
          })) as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        );
      });

      const renderedIds = Array.from(
        container.querySelectorAll("[data-slide-thumbnail-frame]"),
      )
        .filter((frame) =>
          frame.querySelector('[data-testid="slide-renderer"]'),
        )
        .map((frame) => frame.getAttribute("data-slide-thumbnail-frame"));
      // The fifth slide is near; the active first slide always renders.
      expect(renderedIds).toEqual(["slide-1", "slide-5"]);
      // Far thumbnails keep their frame, so the rail's height does not change.
      expect(
        container.querySelectorAll("[data-slide-thumbnail-frame]"),
      ).toHaveLength(slides.length);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({})),
      );
    }
  });
});

describe("selectionFollowingActiveSlide", () => {
  it("selects only the open slide when it is outside the selection", () => {
    expect(selectionFollowingActiveSlide(["slide-1"], "slide-5")).toEqual([
      "slide-5",
    ]);
  });

  it("keeps a selection that already holds the open slide", () => {
    expect(
      selectionFollowingActiveSlide(["slide-1", "slide-5"], "slide-5"),
    ).toBeNull();
    expect(selectionFollowingActiveSlide(["slide-1"], null)).toBeNull();
  });
});
