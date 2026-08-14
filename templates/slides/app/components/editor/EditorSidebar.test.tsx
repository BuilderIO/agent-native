// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

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

import EditorSidebar from "./EditorSidebar";

afterEach(() => cleanup());

describe("EditorSidebar thumbnail scroll cue", () => {
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

describe("EditorSidebar arrow navigation", () => {
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
