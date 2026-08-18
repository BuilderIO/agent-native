// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, type AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareButton: vi.fn(() => null),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "editorToolbar.savedVersions" ? "History" : key,
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
}));

vi.mock("./editor-command-model", () => ({
  registerEditorCommands: () => undefined,
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
});
