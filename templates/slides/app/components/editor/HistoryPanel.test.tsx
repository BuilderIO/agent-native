// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  versionsQuery: null as any,
  versionQuery: null as any,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/deck/SlideRenderer", () => ({ default: () => null }));
vi.mock("@/context/DeckContext", () => ({
  useDecks: () => ({
    flushDeckSave: vi.fn(),
    refreshOpenDeck: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-deck-versions", () => ({
  useDeckVersions: () => mocks.versionsQuery,
  useDeckVersion: () => mocks.versionQuery,
  useRestoreDeckVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetDescription: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <header>{children}</header>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

import HistoryPanel from "./HistoryPanel";

beforeEach(() => {
  mocks.versionsQuery = {
    data: undefined,
    isLoading: false,
    isError: true,
    isSuccess: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  mocks.versionQuery = {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    isFetching: false,
    refetch: vi.fn(),
  };
});

afterEach(cleanup);

describe("HistoryPanel", () => {
  it("shows a retryable load error instead of an empty-history state", () => {
    render(<HistoryPanel deckId="deck-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "history.loadFailed",
    );
    expect(screen.queryByText("history.noSavedVersions")).toBeNull();
    fireEvent.click(screen.getByText("history.retry"));
    expect(mocks.versionsQuery.refetch).toHaveBeenCalledOnce();
  });

  it("keeps a successful empty response distinct from a load failure", () => {
    mocks.versionsQuery = {
      data: { versions: [] },
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(<HistoryPanel deckId="deck-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByText("history.noSavedVersions")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not treat a malformed successful response as empty history", () => {
    mocks.versionsQuery = {
      data: { versions: null },
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(<HistoryPanel deckId="deck-1" open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toContain(
      "history.loadFailed",
    );
    expect(screen.queryByText("history.noSavedVersions")).toBeNull();
  });

  it("shows a retry when a selected snapshot fails to load", () => {
    mocks.versionsQuery = {
      data: {
        versions: [
          {
            id: "version-1",
            title: "Version 1",
            slideCount: 1,
            createdAt: "2026-09-29T12:00:00.000Z",
            slidePreviews: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    };
    mocks.versionQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(<HistoryPanel deckId="deck-1" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByText("Version 1"));

    expect(screen.getByRole("alert").textContent).toContain(
      "history.snapshotLoadFailed",
    );
    fireEvent.click(screen.getByText("history.retry"));
    expect(mocks.versionQuery.refetch).toHaveBeenCalledOnce();
    expect(
      (screen.getByText("history.restoreThisVersion") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
