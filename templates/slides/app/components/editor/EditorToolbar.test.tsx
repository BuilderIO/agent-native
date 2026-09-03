// @vitest-environment happy-dom

import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, type AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareButton: vi.fn(() => null),
  registerEditorCommands: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "editorToolbar.savedVersions"
      ? "History"
      : key === "creativeContext.share.tabLabel"
        ? "Context"
        : key,
}));

vi.mock("@agent-native/core/client/progress", () => ({
  RunsTray: () => null,
}));

vi.mock("@agent-native/core/client/sharing", () => ({
  ShareButton: mocks.shareButton,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareTab: () => null,
}));

vi.mock("@agent-native/toolkit/collab-ui", () => ({
  PresenceBar: () => null,
}));

vi.mock("@/components/visual-editor", () => ({
  SaveStatusIndicator: () => null,
}));

vi.mock("@/context/DeckContext", () => ({
  useSaveState: () => ({ saving: false }),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: unknown[]) =>
    classes
      .flat(Infinity)
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" "),
}));

vi.mock("./ExportMenu", () => ({
  ExportMenu: () => null,
  ExportStatusDialog: () => null,
}));

vi.mock("./editor-command-model", () => ({
  registerEditorCommands: mocks.registerEditorCommands,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: vi.fn(),
    resolvedTheme: "light",
  }),
}));

vi.mock("react-router", () => ({
  Link: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { type Deck } from "@/context/DeckContext";

import EditorToolbar from "./EditorToolbar";

type ShareButtonProps = {
  resourceType?: string;
  resourceId?: string;
  resourceTitle?: string;
  shareUrl?: string;
  secondaryShareUrl?: string;
  shareUrlLabel?: string;
  shareUrlDescription?: string;
  secondaryShareUrlLabel?: string;
  secondaryShareUrlDescription?: string;
  roleCopy?: {
    commenter?: {
      label: string;
      description?: string;
    };
  };
  shareTabs?: {
    tabs?: Array<{
      value?: string;
      label?: string;
      content?: unknown;
    }>;
  };
};

const deck: Deck = {
  id: "deck-1",
  title: "Test deck",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  slides: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("<EditorToolbar>", () => {
  it("registers the editor actions in the Cmd+K palette", () => {
    const onAddEmptySlide = vi.fn();
    const onToggleTextBoxMode = vi.fn();
    const onSelectShape = vi.fn();
    const onToggleAnimations = vi.fn();
    const onToggleLayers = vi.fn();
    const onChangeSlideTransition = vi.fn();
    const slide = {
      id: "slide-1",
      content: "",
      notes: "",
      layout: "blank" as const,
      transition: "instant" as const,
    };

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
          currentSlide={slide}
          onAddEmptySlide={onAddEmptySlide}
          onToggleTextBoxMode={onToggleTextBoxMode}
          onSelectShape={onSelectShape}
          onToggleAnimations={onToggleAnimations}
          onToggleLayers={onToggleLayers}
          onChangeSlideTransition={onChangeSlideTransition}
        />
      </TooltipProvider>,
    );

    const source = mocks.registerEditorCommands.mock.calls.at(-1)?.[0] as
      | (() => ReadonlyArray<{ id: string; run: () => void }>)
      | undefined;
    const commands = source?.() ?? [];
    const commandIds = commands.map((command) => command.id);

    expect(commandIds).toEqual(
      expect.arrayContaining([
        "new-slide",
        "add-text-box",
        "shape-rectangle",
        "shape-circle",
        "element-animations",
        "layers",
        "slide-transition-instant",
        "slide-transition-fade",
        "slide-transition-slide",
        "slide-transition-zoom",
        "download-html",
        "export-pdf",
        "export-pptx",
        "import-file",
        "saved-versions",
      ]),
    );

    const run = (id: string) =>
      commands.find((command) => command.id === id)?.run();
    run("new-slide");
    run("add-text-box");
    run("shape-rectangle");
    run("element-animations");
    run("layers");
    run("slide-transition-fade");

    expect(onAddEmptySlide).toHaveBeenCalledOnce();
    expect(onToggleTextBoxMode).toHaveBeenCalledOnce();
    expect(onSelectShape).toHaveBeenCalledWith("rectangle");
    expect(onToggleAnimations).toHaveBeenCalledOnce();
    expect(onToggleLayers).toHaveBeenCalledOnce();
    expect(onChangeSlideTransition).toHaveBeenCalledWith("fade");
  });

  it("does not register shape tools without an active slide", () => {
    const onSelectShape = vi.fn();

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
          onSelectShape={onSelectShape}
        />
      </TooltipProvider>,
    );

    const source = mocks.registerEditorCommands.mock.calls.at(-1)?.[0] as
      | (() => ReadonlyArray<{ id: string }>)
      | undefined;
    const commandIds = (source?.() ?? []).map((command) => command.id);

    expect(commandIds).not.toEqual(
      expect.arrayContaining(["shape-rectangle", "shape-circle"]),
    );
    expect(onSelectShape).not.toHaveBeenCalled();
  });

  it("labels source-preserving decks as limited editing", () => {
    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
          sourceImported
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("editorToolbar.sourcePreserving")).toBeTruthy();
  });

  it("surfaces history from the top-right overflow menu", async () => {
    const onShowHistory = vi.fn();
    const historyButtonRef = createRef<HTMLButtonElement>();

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={onShowHistory}
          historyButtonRef={historyButtonRef}
        />
      </TooltipProvider>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "editorToolbar.more" }),
      { button: 0, ctrlKey: false },
    );

    const historyItem = await screen.findByRole("menuitem", {
      name: "History",
    });
    fireEvent.click(historyItem);

    await waitFor(() => expect(onShowHistory).toHaveBeenCalledTimes(1));
  });

  it("passes the shared Slides share contract through the core ShareButton", () => {
    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
        />
      </TooltipProvider>,
    );

    const shareButtonCalls = mocks.shareButton.mock.calls as unknown as Array<
      [ShareButtonProps]
    >;
    const shareButtonProps: ShareButtonProps =
      shareButtonCalls[shareButtonCalls.length - 1]?.[0] ?? {};

    expect(shareButtonProps?.resourceType).toBe("deck");
    expect(shareButtonProps?.resourceId).toBe("deck-1");
    expect(shareButtonProps?.resourceTitle).toBe("Test deck");
    expect(shareButtonProps?.shareUrl).toEqual(
      expect.stringContaining("/deck/deck-1"),
    );
    expect(shareButtonProps?.secondaryShareUrl).toEqual(
      expect.stringContaining("/p/deck-1"),
    );
    expect(shareButtonProps?.shareUrlLabel).toBe("editorToolbar.editorLink");
    expect(shareButtonProps?.shareUrlDescription).toBe(
      "editorToolbar.editorLinkDescription",
    );
    expect(shareButtonProps?.secondaryShareUrlLabel).toBe(
      "editorToolbar.presentationLink",
    );
    expect(shareButtonProps?.secondaryShareUrlDescription).toBe(
      "editorToolbar.presentationLinkDescription",
    );
    expect(shareButtonProps?.roleCopy?.commenter).toEqual({
      label: "editorToolbar.commenterRoleLabel",
      description: "editorToolbar.commenterRoleDescription",
    });
    expect(shareButtonProps.shareTabs?.tabs?.[0]?.value).toBe("context");
    expect(shareButtonProps.shareTabs?.tabs?.[0]?.label).toBe("Context");
    expect(shareButtonProps.shareTabs?.tabs?.[0]?.content).toBeTruthy();
  });

  it("delegates Present so the editor can flush pending changes first", () => {
    const onPresent = vi.fn();

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
          onPresent={onPresent}
        />
      </TooltipProvider>,
    );

    const presentLink = screen.getByText("editorToolbar.present").closest("a");
    expect(presentLink).not.toBeNull();
    fireEvent.click(presentLink!);

    expect(onPresent).toHaveBeenCalledTimes(1);
  });

  it("flushes before modified and auxiliary Present clicks without hijacking them", () => {
    const onPresent = vi.fn();

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
          onPresent={onPresent}
        />
      </TooltipProvider>,
    );

    const presentLink = screen.getByText("editorToolbar.present").closest("a");
    expect(presentLink).not.toBeNull();

    for (const eventInit of [{ metaKey: true }, { button: 1 }]) {
      const event = createEvent.click(presentLink!, eventInit);
      fireEvent(presentLink!, event);
      expect(event.defaultPrevented).toBe(false);
    }

    fireEvent(
      presentLink!,
      new MouseEvent("auxclick", { bubbles: true, button: 2 }),
    );

    expect(onPresent).toHaveBeenCalledTimes(2);
    expect(onPresent).toHaveBeenNthCalledWith(1, {
      preserveNativeNavigation: true,
    });
    expect(onPresent).toHaveBeenNthCalledWith(2, {
      preserveNativeNavigation: true,
    });
  });

  it("lets the Present owner prevent native navigation when it opens a waiting tab", () => {
    const onPresent = vi.fn(() => true);

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={vi.fn()}
          historyButtonRef={createRef<HTMLButtonElement>()}
          onPresent={onPresent}
        />
      </TooltipProvider>,
    );

    const presentLink = screen.getByText("editorToolbar.present").closest("a");
    expect(presentLink).not.toBeNull();

    const event = createEvent.click(presentLink!, { metaKey: true });
    fireEvent(presentLink!, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onPresent).toHaveBeenCalledWith({
      preserveNativeNavigation: true,
    });
  });
});
