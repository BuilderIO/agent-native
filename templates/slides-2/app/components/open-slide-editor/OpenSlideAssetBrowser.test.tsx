// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  mutateAsync: vi.fn(),
  storageConfigured: true,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => mocks.query(...args),
  useActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "comments.thisSlide": "This Slide",
      "editorToolbar.assetLibrary": "Asset Library",
      "editorToolbar.globalAssetScope": "Global",
      "header.deck": "Deck",
      "openSlideEditor.mediaFilters.all": "All",
      "openSlideEditor.mediaFilters.image": "Images",
      "openSlideEditor.mediaFilters.video": "Videos",
      "openSlideEditor.mediaTypeFilter": "Filter by media type",
      "openSlideEditor.assetsLoadFailed": "Could not load media",
      "openSlideEditor.uploadMedia": "Upload media",
      "openSlideEditor.searchMediaPlaceholder": "Search images and videos",
      "openSlideEditor.searchLogos": "Search logos",
      "openSlideEditor.addLogo": "Add logo",
      "openSlideEditor.videoUploadFailed": "Video upload failed",
      "openSlideEditor.videoInsertFailed": "Video insert failed",
      "openSlideEditor.noAssetsMatch": "No media matches",
      "openSlideEditor.noVideosYet": "No videos yet",
      "raw.noAssetsYet": "No images yet",
      "raw.mediaUploadFailed": "Media upload failed",
      "raw.uploading": "Uploading",
      "raw.logoSearchTitle": "Logo Search",
      "raw.searchCompanyPlaceholder": "Search company name",
      "raw.search": "Search",
      "raw.searchCompanyLogo": "Search for a company to find their logo",
      "raw.noLogosFound": "No logos found",
      "raw.searchFailed": "Search failed",
      "raw.assetErrors.assetSaveFailed": "Asset save failed",
      "raw.assetErrors.listFailed": "Could not load images",
      "appMenu.themeLight": "Light",
      "appMenu.themeDark": "Dark",
      "designSystemSetup.saving": "Saving",
      "comments.retry": "Retry",
      "comments.cancel": "Cancel",
      "deckCard.rename": "Rename",
      "contextToolbar.replaceImage": "Replace image",
    })[key] ?? key,
}));

vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: mocks.storageConfigured },
    isError: false,
    isSuccess: true,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/components/editor/UploadStorageGate", async () => {
  const React = await import("react");
  return {
    UploadStorageGate: ({
      configured,
      open,
    }: {
      configured: boolean;
      open: boolean;
    }) =>
      open && !configured
        ? React.createElement("div", { "data-testid": "upload-storage-gate" })
        : null,
  };
});

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) =>
      open ? React.createElement("div", { role: "dialog" }, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement("section", null, children),
    DialogFooter: ({ children }: { children: React.ReactNode }) =>
      React.createElement("footer", null, children),
    DialogDescription: ({ children }: { children: React.ReactNode }) =>
      React.createElement("p", null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) =>
      React.createElement("header", null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
  };
});

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<{
    value: string;
    onValueChange: (value: string) => void;
  }>({ value: "", onValueChange: () => {} });

  return {
    Tabs: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) =>
      React.createElement(
        TabsContext.Provider,
        { value: { value, onValueChange } },
        React.createElement("div", null, children),
      ),
    TabsList: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { role: "tablist" }, children),
    TabsTrigger: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const context = React.useContext(TabsContext);
      return React.createElement(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected": context.value === value,
          onClick: () => context.onValueChange(value),
        },
        children,
      );
    },
    TabsContent: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const context = React.useContext(TabsContext);
      return context.value === value
        ? React.createElement("div", null, children)
        : null;
    },
  };
});

import { OpenSlideAssetBrowser } from "./OpenSlideAssetBrowser";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storageConfigured = true;
  mocks.refetch.mockResolvedValue({ isSuccess: false, data: undefined });
  mocks.query.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
  });
});

describe("OpenSlideAssetBrowser", () => {
  it("announces asset-list failures and retries the read", () => {
    mocks.query.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: { errorCode: "asset_list_failed" },
      refetch: mocks.refetch,
    });

    render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={vi.fn()}
        canInsert
        onInsert={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load media",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("requests active-slide, deck-catalog, and global assets from their matching scopes", () => {
    render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={vi.fn()}
        canInsert
        onInsert={vi.fn()}
      />,
    );

    expect(mocks.query).toHaveBeenLastCalledWith(
      "list-assets",
      {
        scope: "slide",
        media: "all",
        deckId: "deck-1",
        slideId: "slide-2",
      },
      { enabled: true },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Deck" }));
    expect(mocks.query).toHaveBeenLastCalledWith(
      "list-assets",
      { scope: "deck", media: "all", deckId: "deck-1" },
      { enabled: true },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Global" }));
    expect(mocks.query).toHaveBeenLastCalledWith(
      "list-assets",
      { scope: "global", media: "all" },
      { enabled: true },
    );
  });

  it("renames a global image with the update-asset action", async () => {
    const asset = {
      id: "asset-1",
      url: "https://assets.example.com/cover.png",
      filename: "cover.png",
      size: 100,
      createdAt: "2026-10-19T00:00:00.000Z",
      type: "image/png",
    };
    mocks.query.mockImplementation(
      (_name: string, args: { scope?: string }) => ({
        data: args.scope === "global" ? [asset] : [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: mocks.refetch,
      }),
    );
    mocks.mutateAsync.mockResolvedValue({
      success: true,
      filename: "cover-renamed.png",
    });

    render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={vi.fn()}
        canInsert
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Global" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(input, { target: { value: "cover-renamed.png" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        id: "asset-1",
        filename: "cover-renamed.png",
      }),
    );
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("searches SVGL and imports the selected variant into the active deck", async () => {
    const onInsert = vi.fn().mockResolvedValue(null);
    const onOpenChange = vi.fn();
    mocks.query.mockImplementation((actionName: string) =>
      actionName === "search-svgl-logos"
        ? {
            data: [
              {
                id: 42,
                title: "Acme",
                category: "Software",
                route: {
                  light: "https://svgl.app/acme-light.svg",
                  dark: "https://svgl.app/acme-dark.svg",
                },
              },
            ],
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            refetch: mocks.refetch,
          }
        : {
            data: [],
            isLoading: false,
            isError: false,
            error: null,
            refetch: mocks.refetch,
          },
    );
    mocks.mutateAsync.mockResolvedValue({
      id: "asset-1",
      assetId: "asset-1",
      filename: "acme.svg",
      type: "image/svg+xml",
    });

    render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={onOpenChange}
        canInsert
        onInsert={onInsert}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search logos" }));
    const searchInput = screen.getByRole("textbox", {
      name: "Search company name",
    });
    fireEvent.change(searchInput, { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(mocks.query).toHaveBeenCalledWith(
        "search-svgl-logos",
        { q: "Acme" },
        { enabled: true },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Add logo: Acme" }));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        route: "https://svgl.app/acme-dark.svg",
        title: "Acme",
        deckId: "deck-1",
      }),
    );
    expect(onInsert).toHaveBeenCalledWith(
      "asset-1",
      "acme.svg",
      "image/svg+xml",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens storage setup instead of importing when uploads are unavailable", async () => {
    mocks.storageConfigured = false;
    mocks.query.mockImplementation((actionName: string) =>
      actionName === "search-svgl-logos"
        ? {
            data: [
              {
                id: 42,
                title: "Acme",
                category: "Software",
                route: "https://svgl.app/acme.svg",
              },
            ],
            isLoading: false,
            isFetching: false,
            isError: false,
            error: null,
            refetch: mocks.refetch,
          }
        : {
            data: [],
            isLoading: false,
            isError: false,
            error: null,
            refetch: mocks.refetch,
          },
    );

    render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={vi.fn()}
        canInsert
        onInsert={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search logos" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search company name" }),
      { target: { value: "Acme" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Add logo: Acme" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("upload-storage-gate")).toBeTruthy(),
    );
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("filters by video and passes the uploaded handle and MIME type to insertion", async () => {
    const onInsert = vi.fn().mockResolvedValue(null);
    const onOpenChange = vi.fn();
    mocks.query.mockImplementation(
      (_name: string, args: { media?: string }) => ({
        data:
          args.media === "video"
            ? [
                {
                  id: "video-1",
                  url: "https://assets.example.com/video-1",
                  filename: "intro.mp4",
                  size: 500,
                  createdAt: "2026-10-19T00:00:00.000Z",
                  type: "video/mp4",
                },
              ]
            : [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: mocks.refetch,
      }),
    );

    const { container } = render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={onOpenChange}
        canInsert
        onInsert={onInsert}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    expect(mocks.query).toHaveBeenLastCalledWith(
      "list-assets",
      { scope: "slide", media: "video", deckId: "deck-1", slideId: "slide-2" },
      { enabled: true },
    );
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://assets.example.com/video-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "intro.mp4" }));

    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith(
        "video-1",
        "intro.mp4",
        "video/mp4",
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens the deck catalog after uploading an image from This Slide", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={vi.fn()}
        canInsert
        onInsert={vi.fn()}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["image"], "new-image.png", { type: "image/png" })],
      },
    });

    await waitFor(() =>
      expect(mocks.query).toHaveBeenLastCalledWith(
        "list-assets",
        { scope: "deck", media: "all", deckId: "deck-1" },
        { enabled: true },
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/assets/upload"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uploads MP4 files through the video upload route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "video-2", type: "video/mp4" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <OpenSlideAssetBrowser
        deckId="deck-1"
        slideId="slide-2"
        open
        onOpenChange={vi.fn()}
        canInsert
        onInsert={vi.fn()}
      />,
    );
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput?.getAttribute("accept")).toContain("video/mp4");

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(["video"], "intro.mp4", { type: "video/mp4" })],
      },
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/upload-video"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(mocks.query).toHaveBeenLastCalledWith(
        "list-assets",
        { scope: "deck", media: "all", deckId: "deck-1" },
        { enabled: true },
      ),
    );
  });
});
