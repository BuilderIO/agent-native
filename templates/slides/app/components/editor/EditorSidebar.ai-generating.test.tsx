import type { AttributedRecentEdit } from "@agent-native/core/client/collab";
// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: ({
    onSubmit,
  }: {
    onSubmit: (text: string, files: File[]) => void;
  }) => (
    <button type="button" onClick={() => onSubmit("a slide about trees", [])}>
      submit-prompt
    </button>
  ),
}));

vi.mock("@agent-native/toolkit/collab-ui", () => ({
  DEFAULT_AGENT_IDENTITY: { email: "agent@example.com", color: "#5b8cff" },
}));

vi.mock("@/components/deck/SlideRenderer", () => ({
  default: () => <div data-testid="slide-renderer" />,
}));

vi.mock("@/components/editor/AiEditingMarker", () => ({
  AiEditingMarker: () => <span data-testid="ai-marker" />,
}));

vi.mock("@/components/editor/GeneratingSlidePreview", () => ({
  default: () => null,
}));

vi.mock("@/components/editor/GoogleDocImportHint", () => ({
  GoogleDocImportHint: () => null,
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

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

Element.prototype.scrollIntoView = () => {};

import EditorSidebar from "./EditorSidebar";

function slide(id: string): Slide {
  return { id, content: "<div />", notes: "", layout: "content" };
}

const slides = [slide("slide-1"), slide("slide-2"), slide("slide-3")];

afterEach(() => cleanup());

describe("EditorSidebar AI-active slide", () => {
  it("marks the placeholder the agent is filling, not another row", () => {
    render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-2"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
        aiGeneratingSlideId="slide-2"
      />,
    );

    const markers = screen.getAllByTestId("ai-marker");
    expect(markers).toHaveLength(1);
    const activeThumbnail = markers[0].closest("[data-slide-thumbnail-id]");
    expect(activeThumbnail?.getAttribute("data-slide-thumbnail-id")).toBe(
      "slide-2",
    );
    expect(
      activeThumbnail?.querySelector(".slide-thumbnail-ai-shimmer"),
    ).not.toBeNull();
    const otherThumbnail = document.querySelector(
      '[data-slide-thumbnail-id="slide-1"]',
    );
    expect(
      otherThumbnail?.querySelector(".slide-thumbnail-ai-shimmer"),
    ).toBeFalsy();
  });

  it("shows the badge but not the shimmer for a slide with only a lingering recent edit", () => {
    const recentEdits: AttributedRecentEdit[] = [
      {
        descriptor: { kind: "paths", paths: ["slides.slide-3"] },
        at: Date.now(),
        clientId: 1,
        user: { name: "Agent", color: "#5b8cff", email: "agent@example.com" },
        isAgent: true,
      },
    ];

    render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-2"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
        recentEdits={recentEdits}
      />,
    );

    const recentlyEditedThumbnail = document.querySelector(
      '[data-slide-thumbnail-id="slide-3"]',
    );
    expect(screen.getAllByTestId("ai-marker")).toHaveLength(1);
    expect(
      recentlyEditedThumbnail?.querySelector(".slide-thumbnail-ai-shimmer"),
    ).toBeNull();
  });

  it("renders no generating row while a placeholder is filled in place", () => {
    render(
      <EditorSidebar
        slides={slides}
        activeSlideId="slide-2"
        deckId="deck-1"
        deckTitle="Test deck"
        onSelectSlide={() => {}}
        describeSlideId={null}
        onCloseDescribe={() => {}}
        addSlideAgentSubmit={() => {}}
        aiGeneratingSlideId="slide-2"
      />,
    );

    expect(screen.queryByLabelText("editorSidebar.generatingSlide")).toBeNull();
    expect(screen.getAllByTestId("slide-renderer")).toHaveLength(slides.length);
  });

  it("reports the placeholder id when the describe prompt is submitted", async () => {
    const onAddSlideGeneratingChange = vi.fn();
    const addSlideAgentSubmit = vi.fn();
    const props = {
      slides,
      activeSlideId: "slide-2",
      deckId: "deck-1",
      deckTitle: "Test deck",
      onSelectSlide: () => {},
      onCloseDescribe: () => {},
      onAddSlideGeneratingChange,
      onAwaitAddSlidePersisted: () => Promise.resolve(),
      addSlideAgentSubmit,
    };
    // "New slide" sets the describe target after the rail is already mounted;
    // the popover only anchors once that thumbnail's ref re-registers.
    const { rerender } = render(
      <EditorSidebar {...props} describeSlideId={null} />,
    );
    rerender(<EditorSidebar {...props} describeSlideId="slide-2" />);

    await act(async () => {
      fireEvent.click(screen.getByText("submit-prompt"));
    });

    expect(onAddSlideGeneratingChange).toHaveBeenCalledWith(true, "slide-2");
    const [, context] = addSlideAgentSubmit.mock.calls[0];
    expect(context).toContain("id: slide-2");
    expect(context).toContain("do not call `add-slide`");
  });
});
