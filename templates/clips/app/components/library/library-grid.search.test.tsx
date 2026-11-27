// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  useInfiniteRecordings: vi.fn(),
  useRecordingsCount: vi.fn(),
  setClientAppState: vi.fn(async () => {}),
}));

vi.mock("react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab-1",
  setClientAppState: mocks.setClientAppState,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/shared", () => ({
  normalizeDocumentTitle: (value: string) => value,
}));

vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: () => null,
}));

vi.mock("@tabler/icons-react", () => {
  const Icon = () => <span />;
  return { IconAlertTriangle: Icon, IconPhoto: Icon, IconX: Icon };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/library/create-folder-dialog", () => ({
  CreateFolderDialog: () => null,
}));

vi.mock("@/components/player/share-dialog", () => ({
  ShareRecordingDialog: () => null,
}));

vi.mock("@/components/ui/context-menu", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    ContextMenu: Passthrough,
    ContextMenuContent: () => null,
    ContextMenuItem: Passthrough,
    ContextMenuSeparator: () => null,
    ContextMenuTrigger: Passthrough,
  };
});

vi.mock("@/hooks/use-drop-video-upload", () => ({
  useDropVideoUpload: () => ({ uploads: [], uploadFiles: vi.fn() }),
}));

vi.mock("@/hooks/use-upload-video-picker", () => ({
  useUploadVideoPicker: () => ({ input: null, openUploadPicker: vi.fn() }),
}));

vi.mock("@/hooks/use-video-storage-status", () => ({
  fetchVideoStorageStatus: vi.fn(async () => ({ configured: true })),
  useVideoStorageStatus: () => ({ refetch: vi.fn() }),
}));

vi.mock("@/hooks/use-library", () => ({
  dedupeRecordingsById: (rows: unknown[]) => rows,
  useFolders: () => ({ data: { folders: [] }, isLoading: false }),
  useOrganizations: () => ({
    data: { organizations: [{ id: "org-1" }], currentId: "org-1" },
  }),
  useInfiniteRecordings: (...args: unknown[]) =>
    mocks.useInfiniteRecordings(...args),
  useRecordingsCount: (...args: unknown[]) => mocks.useRecordingsCount(...args),
  useLibraryFilterSummary: () => ({ data: undefined }),
  useTrashRecording: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useArchiveRecording: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useRestoreRecording: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useMoveRecording: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("./bulk-action-toolbar", () => ({
  BulkActionToolbar: () => null,
}));

vi.mock("./dropped-upload-card", () => ({
  DroppedUploadCard: () => null,
}));

vi.mock("./empty-state", () => ({
  AppEmptyState: () => <div data-testid="app-empty-state" />,
  EmptyState: ({ kind }: { kind: string }) => (
    <div data-testid="empty-state" data-kind={kind} />
  ),
}));

vi.mock("./library-filters", () => ({
  LibraryFilterButton: () => null,
  useLibraryFilter: () => ({
    query: "",
    isDefault: true,
    state: {},
    setState: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("./filter-chips", () => ({
  FilterChips: ({
    chips,
  }: {
    chips: Array<{ key: string; label: string; onRemove?: () => void }>;
  }) => (
    <div data-testid="filter-chips">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          data-chip={chip.key}
          onClick={chip.onRemove}
        >
          {chip.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./folder-card", () => ({
  FolderCard: () => null,
}));

vi.mock("./page-header", () => ({
  PageBreadcrumb: () => null,
  PageHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}));

vi.mock("./recording-card", () => ({
  RecordingCard: ({
    recording,
    selected,
    onToggleSelect,
  }: {
    recording: { id: string; title: string };
    selected?: boolean;
    onToggleSelect?: (id: string) => void;
  }) => (
    <div data-testid="recording-card" data-selected={String(Boolean(selected))}>
      <span>{recording.title}</span>
      <button
        type="button"
        data-select={recording.id}
        onClick={() => onToggleSelect?.(recording.id)}
      >
        Select
      </button>
    </div>
  ),
}));

vi.mock("./search-bar", () => ({
  SearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock("./sort-menu", () => ({
  SortMenu: () => null,
}));

import { LibraryGrid } from "./library-grid";

describe("LibraryGrid URL search (?q=)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();
    mocks.setClientAppState.mockClear();
    mocks.useRecordingsCount.mockReset().mockReturnValue({ data: 1 });
    mocks.useInfiniteRecordings.mockReset().mockReturnValue({
      data: {
        pages: [
          {
            recordings: [
              {
                id: "rec-1",
                title: "Onboarding demo",
                description: "",
                kind: "video",
                thumbnailUrl: null,
                animatedThumbnailUrl: null,
                durationMs: 3000,
                effectiveDurationMs: 3000,
                status: "ready",
                visibility: "private",
                hasPassword: false,
                expiresAt: null,
                ownerEmail: "qa@example.test",
                folderId: null,
                spaceIds: [],
                tags: [],
                viewCount: 0,
                agentViewCount: 0,
                createdAt: "2026-11-20T00:00:00.000Z",
                updatedAt: "2026-11-20T00:00:00.000Z",
                archivedAt: null,
                trashedAt: null,
                hasAudio: true,
                hasCamera: false,
                width: 1280,
                height: 720,
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("passes ?q= into list-recordings and count queries and renders a removable search chip", () => {
    mocks.searchParams = new URLSearchParams({ q: "onboarding" });
    act(() => root.render(<LibraryGrid view="library" kind="video" />));

    expect(mocks.useRecordingsCount).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: "library", search: "onboarding" }),
    );
    expect(mocks.useInfiniteRecordings).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: "library", search: "onboarding" }),
      1,
    );

    const chip = container.querySelector<HTMLButtonElement>(
      '[data-chip="search:onboarding"]',
    );
    expect(chip).not.toBeNull();
    act(() => chip?.click());
    expect(mocks.setSearchParams).toHaveBeenCalled();
    const calls = mocks.setSearchParams.mock.calls;
    const updater = calls[calls.length - 1]?.[0] as (
      prev: URLSearchParams,
    ) => URLSearchParams;
    expect(updater(new URLSearchParams("q=onboarding")).has("q")).toBe(false);
  });

  it("keeps SearchBar visible and renders EmptyState kind=search when ?q= matches nothing", () => {
    mocks.searchParams = new URLSearchParams({ q: "no-such-clip" });
    mocks.useRecordingsCount.mockReturnValue({ data: 0 });
    mocks.useInfiniteRecordings.mockReturnValue({
      data: { pages: [{ recordings: [] }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
    });

    act(() => root.render(<LibraryGrid view="library" kind="video" />));

    expect(
      container.querySelector('[data-testid="search-bar"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="empty-state"]')
        ?.getAttribute("data-kind"),
    ).toBe("search");
  });

  it("clears selection when ?q= changes", () => {
    mocks.searchParams = new URLSearchParams({ q: "onboarding" });
    act(() => root.render(<LibraryGrid view="library" kind="video" />));

    const selectBtn = container.querySelector<HTMLButtonElement>(
      'button[data-select="rec-1"]',
    );
    act(() => selectBtn?.click());
    expect(
      container
        .querySelector('[data-testid="recording-card"]')
        ?.getAttribute("data-selected"),
    ).toBe("true");

    mocks.searchParams = new URLSearchParams({ q: "pricing" });
    act(() => root.render(<LibraryGrid view="library" kind="video" />));
    expect(
      container
        .querySelector('[data-testid="recording-card"]')
        ?.getAttribute("data-selected"),
    ).toBe("false");
  });
});
