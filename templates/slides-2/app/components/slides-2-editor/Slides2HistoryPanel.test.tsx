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
  versionsQuery: null as any,
  versionQuery: null as any,
  restoreMutation: null as any,
  versionArgs: [] as Array<[string | null, string | null]>,
  previewSlides: [] as Array<Record<string, unknown>>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  actionErrorMessage: vi.fn((error: unknown) =>
    error && typeof error === "object" && "actionMessage" in error
      ? String(error.actionMessage)
      : undefined,
  ),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    key === "history.slideCount" ? `${values?.count} slides` : key,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) => mocks.actionErrorMessage(error),
}));

vi.mock("@/hooks/use-deck-versions", () => ({
  useDeckVersions: () => mocks.versionsQuery,
  useDeckVersion: (deckId: string | null, versionId: string | null) => {
    mocks.versionArgs.push([deckId, versionId]);
    return mocks.versionQuery;
  },
  useRestoreDeckVersion: () => mocks.restoreMutation,
}));

vi.mock("@/components/slides-2-runtime/SlideContentRenderer", () => ({
  default: (props: { slide: Record<string, unknown> }) => {
    mocks.previewSlides.push(props.slide);
    return <div data-testid="snapshot-slide" />;
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children, onOpenChange }: any) =>
    open ? (
      <div>
        <button type="button" onClick={() => onOpenChange(false)}>
          close history
        </button>
        {children}
      </div>
    ) : null,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetDescription: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <header>{children}</header>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

import Slides2HistoryPanel from "./Slides2HistoryPanel";

const versionSummary = {
  id: "version-1",
  deckId: "deck-1",
  title: "Version 1",
  label: "Before edits",
  createdAt: "2026-10-18T12:00:00.000Z",
  slideCount: 1,
  aspectRatio: "16:9",
  designSystemId: null,
  slidePreviews: [
    {
      slideNumber: 1,
      id: "slide-1",
      layout: "content",
      textPreview: "Snapshot text",
    },
  ],
};

beforeEach(() => {
  mocks.versionsQuery = {
    data: { deckId: "deck-1", count: 1, versions: [versionSummary] },
    isLoading: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  };
  mocks.versionQuery = {
    data: {
      ...versionSummary,
      data: {},
      slides: [
        {
          id: "slide-1",
          content: "<main>Snapshot text</main>",
          sourceTsx: "export default function CurrentSlide() { return null; }",
          sourceRuntimeRequired: true,
        },
      ],
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  };
  mocks.restoreMutation = {
    mutateAsync: vi.fn().mockResolvedValue({
      id: "deck-1",
      title: "Deck",
      slideCount: 1,
      restoredVersionId: "version-1",
      updatedAt: "2026-10-20T12:00:00.000Z",
      url: "/deck/deck-1",
    }),
    isPending: false,
  };
  mocks.versionArgs = [];
  mocks.previewSlides = [];
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.actionErrorMessage.mockClear();
});

afterEach(cleanup);

describe("Slides2HistoryPanel", () => {
  it("previews the saved snapshot and flushes before restoring it", async () => {
    const calls: string[] = [];
    const onBeforeRestore = vi.fn(async () => {
      calls.push("flush");
    });
    const onRestored = vi.fn(() => {
      calls.push("refresh");
    });
    mocks.restoreMutation.mutateAsync.mockImplementation(async () => {
      calls.push("restore");
      return {
        id: "deck-1",
        title: "Deck",
        slideCount: 1,
        restoredVersionId: "version-1",
        updatedAt: "2026-10-20T12:00:00.000Z",
        url: "/deck/deck-1",
      };
    });

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={vi.fn()}
        onBeforeRestore={onBeforeRestore}
        onRestored={onRestored}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));

    expect(screen.getByTestId("snapshot-slide")).toBeTruthy();
    expect(mocks.versionArgs.at(-1)).toEqual(["deck-1", "version-1"]);
    expect(mocks.previewSlides[0]).toMatchObject({
      id: "slide-1",
      content: "<main>Snapshot text</main>",
      layout: "blank",
    });
    expect(mocks.previewSlides[0]).not.toHaveProperty("sourceTsx");
    expect(mocks.previewSlides[0]).not.toHaveProperty("sourceRuntimeRequired");

    fireEvent.click(
      screen.getByRole("button", { name: "history.restoreThisVersion" }),
    );

    await waitFor(() => {
      expect(calls).toEqual(["flush", "restore", "refresh"]);
    });
    expect(onBeforeRestore).toHaveBeenCalledOnce();
    expect(mocks.restoreMutation.mutateAsync).toHaveBeenCalledWith({
      deckId: "deck-1",
      versionId: "version-1",
    });
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it("shows a retryable version-list error instead of an empty state", () => {
    mocks.versionsQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={vi.fn()}
        onBeforeRestore={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "history.loadFailed",
    );
    expect(screen.queryByText("history.noSavedVersions")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "history.retry" }));
    expect(mocks.versionsQuery.refetch).toHaveBeenCalledOnce();
  });

  it("keeps a selected snapshot failure retryable and blocks restore", () => {
    mocks.versionQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={vi.fn()}
        onBeforeRestore={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));

    expect(screen.getByRole("alert").textContent).toContain(
      "history.snapshotLoadFailed",
    );
    fireEvent.click(screen.getByRole("button", { name: "history.retry" }));
    expect(mocks.versionQuery.refetch).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "history.restoreThisVersion" }),
    ).toHaveProperty("disabled", true);
  });

  it("blocks restore while deck-level saves are pending", async () => {
    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        restoreDisabled
        onOpenChange={vi.fn()}
        onBeforeRestore={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    const restoreButton = screen.getByRole("button", {
      name: "history.restoreThisVersion",
    });
    expect(restoreButton).toHaveProperty("disabled", true);
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(mocks.restoreMutation.mutateAsync).not.toHaveBeenCalled();
    });
  });

  it("offers refresh recovery without restoring the same version twice", async () => {
    const onRestored = vi
      .fn()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={onOpenChange}
        onBeforeRestore={vi.fn()}
        onRestored={onRestored}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "history.restoreThisVersion" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "history.restoreRefreshFailed",
    );
    const retryButton = screen.getByRole("button", { name: "history.retry" });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(onRestored).toHaveBeenCalledTimes(2);
      expect(mocks.restoreMutation.mutateAsync).toHaveBeenCalledOnce();
      expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps refresh recovery visible if the history panel closes during restore", async () => {
    let finishBeforeRestore: (() => void) | undefined;
    const onBeforeRestore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishBeforeRestore = resolve;
        }),
    );
    const onRestored = vi.fn().mockRejectedValue(new Error("refresh failed"));

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={vi.fn()}
        onBeforeRestore={onBeforeRestore}
        onRestored={onRestored}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "history.restoreThisVersion" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "close history" }));
    finishBeforeRestore?.();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "history.restoreRefreshFailed",
    );
    expect(mocks.restoreMutation.mutateAsync).toHaveBeenCalledOnce();
  });

  it("shows the action message without its framework error wrapper", async () => {
    const actionError = Object.assign(
      new Error("Action restore-deck-version failed: Not allowed"),
      { actionMessage: "Not allowed" },
    );
    mocks.restoreMutation.mutateAsync.mockRejectedValueOnce(actionError);

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={vi.fn()}
        onBeforeRestore={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "history.restoreThisVersion" }),
    );

    await waitFor(() => {
      expect(mocks.actionErrorMessage).toHaveBeenCalledWith(actionError);
      expect(mocks.toastError).toHaveBeenCalledWith("history.restoreFailed", {
        description: "Not allowed",
      });
    });
  });

  it("uses the localized restore error when an action error has no message", async () => {
    const actionError = new Error("Action restore-deck-version failed");
    mocks.actionErrorMessage.mockReturnValueOnce(undefined);
    mocks.restoreMutation.mutateAsync.mockRejectedValueOnce(actionError);

    render(
      <Slides2HistoryPanel
        deckId="deck-1"
        open
        onOpenChange={vi.fn()}
        onBeforeRestore={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Version 1/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "history.restoreThisVersion" }),
    );

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("history.restoreFailed", {
        description: "history.restoreFailedDescription",
      });
    });
  });
});
