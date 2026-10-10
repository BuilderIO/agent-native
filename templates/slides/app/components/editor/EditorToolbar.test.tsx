// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  createEvent,
  fireEvent,
  render as renderWithoutQueryClient,
  screen,
  waitFor,
  type RenderOptions,
} from "@testing-library/react";
import { createRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareButton: vi.fn((_props: ShareButtonProps) => null),
  openMcpAppHostLink: vi.fn<(url: string) => Promise<boolean> | false>(
    () => false,
  ),
  exportMenu: vi.fn(),
  registerEditorCommands: vi.fn(),
  widgetEmbed: { value: false },
  creativeContextLabEnabled: { value: true },
  uploadPromptFiles: vi.fn(),
  cleanupUploadedPromptFiles: vi.fn(),
  formatPromptUploadFailure: vi.fn(
    (_error: unknown, description: string) => description,
  ),
  isPromptUploadAuthRequiredError: vi.fn(() => false),
  isPromptUploadLimitError: vi.fn(() => false),
  isPromptUploadNetworkError: vi.fn((_error?: unknown) => false),
  isPromptUploadStorageStatusError: vi.fn(() => false),
  toastError: vi.fn(),
  deckContentConflicts: [] as Array<{ slideId: string; canResolve: boolean }>,
  resolveDeckContentConflict: vi.fn(),
  saving: { value: false },
  readOnlyDirectoryWidget: { value: false },
  saveError: {
    value: undefined as { status?: number; retryable: boolean } | undefined,
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "editorToolbar.savedVersions"
      ? "History"
      : key === "creativeContext.share.tabLabel"
        ? "Context"
        : key,
}));

vi.mock("@agent-native/core/client/mcp-app-host", () => ({
  openMcpAppHostLink: (url: string) => mocks.openMcpAppHostLink(url),
  useIsMcpAppWidgetEmbed: () => mocks.widgetEmbed.value,
  useIsMcpDirectoryWidgetReadOnlyEmbed: () =>
    mocks.readOnlyDirectoryWidget.value,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: vi.fn(),
  }),
}));

vi.mock("@agent-native/toolkit/app/progress", () => ({
  RunsTray: () => <div data-testid="runs-tray" />,
}));

vi.mock("@agent-native/toolkit/app/chat", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AgentToggleButton: () => <button type="button" data-testid="agent-toggle" />,
}));

vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: mocks.shareButton,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareTab: () => null,
  useCreativeContextLab: () => mocks.creativeContextLabEnabled.value,
}));

vi.mock("@agent-native/toolkit/collab-ui", () => ({
  PresenceBar: () => null,
}));

vi.mock("@/components/visual-editor", () => ({
  SaveStatusIndicator: () => <div data-testid="save-status" />,
}));

vi.mock("@/context/DeckContext", () => ({
  getDeckSaveError: () => mocks.saveError.value,
  getStaleContentConflictSlideId: () => undefined,
  hasFailedDeckSave: () => mocks.saveError.value !== undefined,
  hasUnsavedDeckChanges: () => false,
  useDeckContentConflicts: () => mocks.deckContentConflicts,
  useDecks: () => ({
    resolveContentConflict: vi.fn(),
    resolveDeckContentConflict: mocks.resolveDeckContentConflict,
  }),
  useSaveState: () => ({ saving: mocks.saving.value }),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: unknown[]) =>
    classes
      .flat(Infinity)
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" "),
}));

vi.mock("@/lib/prompt-file-uploads", () => ({
  uploadPromptFiles: mocks.uploadPromptFiles,
  cleanupUploadedPromptFiles: mocks.cleanupUploadedPromptFiles,
  formatPromptUploadFailure: mocks.formatPromptUploadFailure,
  isPromptUploadAuthRequiredError: mocks.isPromptUploadAuthRequiredError,
  isPromptUploadLimitError: mocks.isPromptUploadLimitError,
  isPromptUploadNetworkError: mocks.isPromptUploadNetworkError,
  isPromptUploadStorageStatusError: mocks.isPromptUploadStorageStatusError,
}));

vi.mock("./ExportMenu", () => ({
  ExportMenu: (props: { hasSlides?: boolean }) => {
    mocks.exportMenu(props);
    return null;
  },
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
  Link: ({
    children,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { type Deck } from "@/context/DeckContext";
import { SLIDE_FILE_STORAGE_STATUS_KEY } from "@/hooks/use-slide-file-storage-status";

import EditorToolbar from "./EditorToolbar";

function render(ui: ReactNode, options?: RenderOptions) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(SLIDE_FILE_STORAGE_STATUS_KEY, { configured: true });
  return renderWithoutQueryClient(ui, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

type ShareButtonProps = {
  mobileSheet?: boolean;
  basicSharingOnly?: boolean;
  resourceType?: string;
  resourceId?: string;
  resourceTitle?: string;
  panelTitle?: string;
  triggerClassName?: string;
  shareUrl?: string;
  showShareLinks?: boolean;
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
const deckWithSlides: Deck = {
  ...deck,
  slides: [
    {
      id: "slide-1",
      content: "",
      notes: "",
      layout: "blank",
      transition: "instant",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.widgetEmbed.value = false;
  mocks.creativeContextLabEnabled.value = true;
  mocks.deckContentConflicts = [];
  mocks.saveError.value = undefined;
  mocks.saving.value = false;
  mocks.readOnlyDirectoryWidget.value = false;
});

afterEach(() => {
  cleanup();
});

describe("<EditorToolbar>", () => {
  const viewerToolbar = () => (
    <TooltipProvider>
      <EditorToolbar
        deck={deck}
        deckId="deck-1"
        deckTitle="Test deck"
        canEdit={false}
        onTitleChange={vi.fn()}
        currentSlideIndex={0}
        sidebarOpen={true}
        onToggleSidebar={vi.fn()}
        onGenerateImage={vi.fn()}
        onOpenAssetLibrary={vi.fn()}
        onShowHistory={vi.fn()}
        historyButtonRef={createRef<HTMLButtonElement>()}
      />
    </TooltipProvider>
  );

  it("keeps the save failure visible once the role drops to view only", () => {
    mocks.saveError.value = { status: 403, retryable: true };
    render(viewerToolbar());

    expect(screen.getByText("editorToolbar.viewOnly")).toBeTruthy();
    expect(screen.getByTestId("save-status")).toBeTruthy();
  });

  it("shows no save status to a viewer with nothing failed", () => {
    render(viewerToolbar());

    expect(screen.queryByTestId("save-status")).toBeNull();
  });

  it("hides save failures in a read-only directory widget", () => {
    mocks.saveError.value = { status: 403, retryable: true };
    mocks.readOnlyDirectoryWidget.value = true;
    render(viewerToolbar());

    expect(screen.queryByTestId("save-status")).toBeNull();
  });

  const widgetToolbar = (
    props: { onTitleChange?: (title: string) => void } = {},
  ) => (
    <TooltipProvider>
      <EditorToolbar
        deck={deckWithSlides}
        deckId="deck-1"
        deckTitle="Test deck"
        canEdit
        onTitleChange={props.onTitleChange ?? vi.fn()}
        currentSlideIndex={0}
        currentSlide={deckWithSlides.slides[0]}
        sidebarOpen
        onToggleSidebar={vi.fn()}
        onGenerateImage={vi.fn()}
        onOpenAssetLibrary={vi.fn()}
        onShowHistory={vi.fn()}
        historyButtonRef={createRef<HTMLButtonElement>()}
        onToggleComments={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onToggleLayers={vi.fn()}
        onToggleAnimations={vi.fn()}
      />
    </TooltipProvider>
  );

  it("shows the app's top bar in a widget minus what the host and the widget grant own", () => {
    mocks.widgetEmbed.value = true;
    const onTitleChange = vi.fn();
    render(widgetToolbar({ onTitleChange }));

    const title = screen.getByDisplayValue("Test deck");
    expect(title).toHaveProperty("readOnly", false);
    fireEvent.change(title, { target: { value: "Renamed" } });
    expect(onTitleChange).toHaveBeenCalledWith("Renamed");
    // The title sizes to its text exactly as in the app; it does not give way
    // to the other controls.
    expect(title.className).toContain("shrink-0");
    expect(title.className).not.toContain("truncate");

    expect(mocks.shareButton).toHaveBeenCalled();
    const shareProps = mocks.shareButton.mock.calls.at(-1)![0];
    expect(shareProps).toMatchObject({
      resourceType: "deck",
      resourceId: "deck-1",
      resourceTitle: "Test deck",
    });
    // The context tab, access requests and agent links need actions the
    // widget grant does not carry.
    expect(shareProps.shareTabs).toBeUndefined();
    expect(shareProps.basicSharingOnly).toBe(true);
    // Share is the app's popover, not a widget-only bottom sheet.
    expect(shareProps.mobileSheet).toBeFalsy();

    expect(screen.getByText("editorToolbar.present")).toBeTruthy();
    // The host owns navigation and chat.
    expect(screen.queryByLabelText("editorToolbar.backToDecks")).toBeNull();
    expect(screen.queryByTestId("agent-toggle")).toBeNull();
    expect(screen.queryByTestId("runs-tray")).toBeNull();
    screen.getByRole("button", { name: "editorToolbar.more" }).click();
    expect(screen.queryByText("editorToolbar.comments")).toBeNull();
    expect(screen.queryByText("editorToolbar.savedVersions")).toBeNull();
    expect(screen.queryByText("editorToolbar.importFile")).toBeNull();
    expect(mocks.exportMenu).not.toHaveBeenCalled();
  });

  it("keeps the same Share component and sizing in and out of a widget", () => {
    render(widgetToolbar());
    const standard = mocks.shareButton.mock.calls.at(-1)![0];
    cleanup();
    mocks.shareButton.mockClear();

    mocks.widgetEmbed.value = true;
    render(widgetToolbar());
    const embedded = mocks.shareButton.mock.calls.at(-1)![0];

    expect(embedded.mobileSheet).toBe(standard.mobileSheet);
    expect(embedded.triggerClassName).toBe(standard.triggerClassName);
    expect(embedded.showShareLinks).toBe(standard.showShareLinks);
  });

  it("keeps the way back to the deck list and the agent controls outside the widget", () => {
    render(widgetToolbar());

    expect(screen.getByLabelText("editorToolbar.backToDecks")).toBeTruthy();
    expect(screen.getByTestId("agent-toggle")).toBeTruthy();
    expect(screen.getByTestId("runs-tray")).toBeTruthy();
  });

  it("keeps the creative context tab in Share outside the widget", () => {
    render(widgetToolbar());

    const shareProps = mocks.shareButton.mock.calls.at(-1)![0];
    expect(shareProps.shareTabs?.tabs?.[0]?.value).toBe("context");
    expect(shareProps.basicSharingOnly).toBe(false);
    expect(
      screen.queryByRole("button", {
        name: "editorToolbar.openInAgentNative",
      }),
    ).toBeNull();
  });

  describe("Open in Agent-Native", () => {
    const openSpy = vi.fn();

    beforeEach(() => {
      mocks.widgetEmbed.value = true;
      openSpy.mockReset();
      vi.stubGlobal("open", openSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const openButton = () =>
      screen.getByRole("button", { name: "editorToolbar.openInAgentNative" });

    it("asks the host to open the deck's app link", async () => {
      mocks.openMcpAppHostLink.mockResolvedValue(true);
      render(widgetToolbar());

      fireEvent.click(openButton());

      expect(mocks.openMcpAppHostLink).toHaveBeenCalledTimes(1);
      expect(mocks.openMcpAppHostLink.mock.calls[0]![0]).toMatch(
        /\/deck\/deck-1$/,
      );
      await Promise.resolve();
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("opens a new tab when the host has no link bridge", () => {
      mocks.openMcpAppHostLink.mockReturnValue(false);
      render(widgetToolbar());

      fireEvent.click(openButton());

      expect(openSpy).toHaveBeenCalledWith(
        mocks.openMcpAppHostLink.mock.calls[0]![0],
        "_blank",
        "noopener,noreferrer",
      );
    });

    it.each([
      ["refuses the link", () => Promise.resolve(false)],
      ["rejects the request", () => Promise.reject(new Error("blocked"))],
    ])("opens a new tab when the host %s", async (_name, request) => {
      mocks.openMcpAppHostLink.mockImplementation(request);
      render(widgetToolbar());

      fireEvent.click(openButton());

      await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    });
  });

  it("waits for a retry to settle before refetching the role", () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    mocks.saveError.value = { status: 403, retryable: true };
    const { rerender } = render(viewerToolbar());

    mocks.saveError.value = undefined;
    mocks.saving.value = true;
    rerender(viewerToolbar());
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["action", "list-resource-shares"],
    });

    mocks.saveError.value = { status: 403, retryable: true };
    mocks.saving.value = false;
    rerender(viewerToolbar());
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["action", "list-resource-shares"],
    });
    invalidate.mockRestore();
  });

  it("refetches the role once an access-lost failure clears", () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    mocks.saveError.value = { status: 403, retryable: true };
    const { rerender } = render(viewerToolbar());
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["action", "list-resource-shares"],
    });

    mocks.saveError.value = undefined;
    rerender(viewerToolbar());

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-resource-shares"],
    });
    invalidate.mockRestore();
  });

  it("keeps the deck title read-only for viewers", () => {
    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deck}
          deckId="deck-1"
          deckTitle="Test deck"
          canEdit={false}
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

    expect(screen.getByDisplayValue("Test deck")).toHaveProperty(
      "readOnly",
      true,
    );
    expect(screen.getByText("editorToolbar.viewOnly")).toBeTruthy();
  });

  it.each([
    [200, { slideCount: 2 }],
    [500, { error: "Import failed" }],
  ])(
    "cleans up uploaded import files after action status %i",
    async (status, body) => {
      const uploaded = {
        path: "uploads/import.pdf",
        originalName: "import.pdf",
        filename: "import.pdf",
        type: "application/pdf",
        size: 3,
      };
      const file = new File(["pdf"], "import.pdf", { type: "application/pdf" });
      mocks.uploadPromptFiles.mockResolvedValue([uploaded]);
      mocks.cleanupUploadedPromptFiles.mockResolvedValue(undefined);
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify(body), { status })),
      );
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
      const input = document.querySelector<HTMLInputElement>(
        'input[type="file"][accept=".pptx,.docx,.pdf"]',
      )!;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() =>
        expect(mocks.cleanupUploadedPromptFiles).toHaveBeenCalledWith([
          uploaded,
        ]),
      );
      expect(mocks.uploadPromptFiles).toHaveBeenCalledWith(
        [file],
        "home.referenceFileStorageUnavailable",
      );
    },
  );

  it("shows a retryable, markup-free failure when the import service answers with a gateway page", async () => {
    const uploaded = {
      path: "uploads/import.pdf",
      originalName: "import.pdf",
      filename: "import.pdf",
      type: "application/pdf",
      size: 3,
    };
    const file = new File(["pdf"], "import.pdf", { type: "application/pdf" });
    mocks.uploadPromptFiles.mockResolvedValue([uploaded]);
    mocks.cleanupUploadedPromptFiles.mockResolvedValue(undefined);
    mocks.isPromptUploadNetworkError.mockImplementation(
      (error: unknown) =>
        (error as { errorCode?: string }).errorCode ===
        "upload_service_unavailable",
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          "<!DOCTYPE html><html><head><title>504 Gateway Time-out</title></head></html>",
          { status: 504 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
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
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".pptx,.docx,.pdf"]',
    )!;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    const [title, options] = mocks.toastError.mock.calls[0] as [
      string,
      { description: string; action?: { label: string; onClick: () => void } },
    ];
    expect(title).toBe("editorToolbar.importFailed");
    expect(JSON.stringify([title, options.description])).not.toMatch(
      /<!DOCTYPE|<html/i,
    );
    expect(options.action?.label).toBe("home.retry");

    options.action?.onClick();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("registers the editor actions in the Cmd+K palette", () => {
    const onAddEmptySlide = vi.fn();
    const onToggleTextBoxMode = vi.fn();
    const onSelectShape = vi.fn();
    const onToggleAnimations = vi.fn();
    const onToggleLayers = vi.fn();
    const onChangeSlideTransition = vi.fn();
    const onShowHistory = vi.fn();
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
          deck={deckWithSlides}
          deckId="deck-1"
          deckTitle="Test deck"
          onTitleChange={vi.fn()}
          currentSlideIndex={0}
          sidebarOpen={true}
          onToggleSidebar={vi.fn()}
          onGenerateImage={vi.fn()}
          onOpenAssetLibrary={vi.fn()}
          onShowHistory={onShowHistory}
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
    run("saved-versions");

    expect(onAddEmptySlide).toHaveBeenCalledOnce();
    expect(onToggleTextBoxMode).toHaveBeenCalledOnce();
    expect(onSelectShape).toHaveBeenCalledWith("rectangle");
    expect(onToggleAnimations).toHaveBeenCalledOnce();
    expect(onToggleLayers).toHaveBeenCalledOnce();
    expect(onChangeSlideTransition).toHaveBeenCalledWith("fade");
    expect(onShowHistory).toHaveBeenCalledOnce();
  });

  it("disables Present and omits export commands for an empty deck", () => {
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
          onExportGoogleSlides={vi.fn()}
          onPresent={onPresent}
        />
      </TooltipProvider>,
    );

    const source = mocks.registerEditorCommands.mock.calls.at(-1)?.[0] as
      | (() => ReadonlyArray<{ id: string; run: () => void }>)
      | undefined;
    const commandIds = (source?.() ?? []).map((command) => command.id);
    expect(commandIds).not.toEqual(
      expect.arrayContaining([
        "download-html",
        "export-pdf",
        "export-pptx",
        "export-to-google-slides",
      ]),
    );

    const presentButton = screen.getByRole("button", {
      name: "editorToolbar.present",
    });
    expect(presentButton.hasAttribute("disabled")).toBe(true);
    expect(presentButton.closest("a")).toBeNull();
    fireEvent.click(presentButton);
    expect(onPresent).not.toHaveBeenCalled();
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

  it("disables export and Present actions when the deck has no slides", async () => {
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
          onExportGoogleSlides={vi.fn()}
        />
      </TooltipProvider>,
    );

    const presentButton = screen.getByRole("button", {
      name: "editorToolbar.present",
    });
    expect((presentButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(presentButton);
    expect(onPresent).not.toHaveBeenCalled();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "editorToolbar.more" }),
      { button: 0, ctrlKey: false },
    );
    await screen.findByRole("menu");
    expect(mocks.exportMenu.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ hasSlides: false }),
    );
    const source = mocks.registerEditorCommands.mock.calls.at(-1)?.[0] as
      | (() => ReadonlyArray<{ id: string }>)
      | undefined;
    expect((source?.() ?? []).map((command) => command.id)).not.toEqual(
      expect.arrayContaining([
        "download-html",
        "export-pdf",
        "export-pptx",
        "export-to-google-slides",
      ]),
    );
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

  it("keeps transition choices, media tools, and theme toggles out of the overflow menu", async () => {
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
          currentSlide={{
            id: "slide-1",
            content: "",
            notes: "",
            layout: "blank",
            transition: "instant",
          }}
          onChangeSlideTransition={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "editorToolbar.more" }),
      { button: 0, ctrlKey: false },
    );

    await screen.findByRole("menu");
    expect(
      screen.queryByRole("menuitem", {
        name: "editorToolbar.transition_instant",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", {
        name: "editorToolbar.generateImage",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", {
        name: "editorToolbar.assetLibrary",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "editorToolbar.lightTheme" }),
    ).toBeNull();
  });

  it.each([true, false])(
    "passes the shared Slides share contract and gates its context tab (%s)",
    (creativeContextEnabled) => {
      mocks.creativeContextLabEnabled.value = creativeContextEnabled;
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
      expect(shareButtonProps?.panelTitle).toBe("share.title");
      expect(shareButtonProps?.shareUrl).toEqual(
        expect.stringContaining("/deck/deck-1"),
      );
      expect(shareButtonProps?.shareUrlLabel).toBe("editorToolbar.editorLink");
      expect(shareButtonProps?.shareUrlDescription).toBe(
        "editorToolbar.editorLinkDescription",
      );
      expect(shareButtonProps?.secondaryShareUrl).toBeUndefined();
      expect(shareButtonProps?.roleCopy?.commenter).toEqual({
        label: "editorToolbar.commenterRoleLabel",
        description: "editorToolbar.commenterRoleDescription",
      });
      if (creativeContextEnabled) {
        expect(shareButtonProps.shareTabs?.tabs?.[0]?.value).toBe("context");
        expect(shareButtonProps.shareTabs?.tabs?.[0]?.label).toBe("Context");
        expect(shareButtonProps.shareTabs?.tabs?.[0]?.content).toBeTruthy();
      } else {
        expect(shareButtonProps.shareTabs).toBeUndefined();
      }
    },
  );

  it("hides the presentation copy link for an empty public deck", () => {
    render(
      <TooltipProvider>
        <EditorToolbar
          deck={{ ...deck, visibility: "public" }}
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
    const shareButtonProps = shareButtonCalls.at(-1)?.[0];

    expect(shareButtonProps?.shareUrl).toBeUndefined();
    expect(shareButtonProps?.showShareLinks).toBe(false);
  });

  it("delegates Present so the editor can flush pending changes first", () => {
    const onPresent = vi.fn();

    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deckWithSlides}
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
          deck={deckWithSlides}
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
          deck={deckWithSlides}
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

  it("keeps native Present navigation when no owner is provided", () => {
    render(
      <TooltipProvider>
        <EditorToolbar
          deck={deckWithSlides}
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

    const presentLink = screen.getByText("editorToolbar.present").closest("a");
    expect(presentLink?.getAttribute("href")).toBe(
      "/deck/deck-1/present?slide=1",
    );
  });
});
