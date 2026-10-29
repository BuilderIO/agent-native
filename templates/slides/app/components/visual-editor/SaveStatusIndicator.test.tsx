// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeckContentConflict,
  DeckFieldConflict,
  Slide,
} from "@/context/DeckContext";

const toastError = vi.hoisted(() => vi.fn());
const deckState = vi.hoisted(() => ({
  contentConflicts: [] as DeckContentConflict[],
  fieldConflicts: [] as DeckFieldConflict[],
  agentContent: null as string | null,
  slides: [] as Slide[],
  resolveDeckContentConflict: vi.fn(),
  resolveDeckFieldConflict: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/components/deck/SlideRenderer", () => ({
  default: ({ slide }: { slide: Slide }) => (
    <div data-testid="slide-preview">
      {slide.content}|{slide.background ?? ""}
    </div>
  ),
}));
vi.mock("@/hooks/use-deck-design-system", () => ({
  useDeckDesignSystem: () => ({ designSystem: undefined }),
}));
vi.mock("@/context/DeckContext", () => ({
  useDeckContentConflicts: () => deckState.contentConflicts,
  useDeckFieldConflicts: () => deckState.fieldConflicts,
  isAgentSlideContent: (_deckId: string, _slideId: string, content: string) =>
    content === deckState.agentContent,
  useDecks: () => ({
    getDeck: () => ({
      id: "deck-1",
      title: "Deck",
      createdAt: "",
      updatedAt: "",
      slides: deckState.slides,
    }),
    resolveDeckContentConflict: deckState.resolveDeckContentConflict,
    resolveDeckFieldConflict: deckState.resolveDeckFieldConflict,
  }),
}));

import { SaveStatusIndicator } from "./SaveStatusIndicator";

function slide(id: string, over: Partial<Slide> = {}): Slide {
  return { id, content: `<p>${id}</p>`, notes: "", layout: "content", ...over };
}

beforeEach(() => {
  deckState.contentConflicts = [];
  deckState.fieldConflicts = [];
  deckState.agentContent = null;
  deckState.slides = [slide("a"), slide("b"), slide("c")];
  deckState.resolveDeckContentConflict.mockReset();
  deckState.resolveDeckFieldConflict.mockReset();
});

afterEach(cleanup);

describe("SaveStatusIndicator conflict review", () => {
  it("shows typed validation failure details and offers reload", () => {
    const reload = vi.fn();
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        saveFailed
        saveError={{
          status: 400,
          errorCode: "slide_content_hash_required",
          retryable: false,
        }}
        onReload={reload}
      />,
    );

    expect(
      screen.getByRole("alert").getAttribute("data-save-error-status"),
    ).toBe("400");
    expect(screen.getByRole("alert").getAttribute("data-save-error-code")).toBe(
      "slide_content_hash_required",
    );
    expect(screen.getByText("400 · slide_content_hash_required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "settings.retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings.reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says another person changed the deck instead of showing the revision code", () => {
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        saveFailed
        saveError={{
          status: 409,
          errorCode: "deck_revision_conflict",
          retryable: false,
        }}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText("editorToolbar.saveErrorDeckChanged")).toBeTruthy();
    expect(screen.queryByText(/deck_revision_conflict/)).toBeNull();
  });

  it.each([403, 404])(
    "labels a %i save failure as lost access and offers retry and reload",
    (status) => {
      const retry = vi.fn().mockResolvedValue(undefined);
      render(
        <SaveStatusIndicator
          deckId="deck-1"
          saving={false}
          saveFailed
          saveError={{ status, retryable: true }}
          onRetrySave={retry}
          onReload={vi.fn()}
        />,
      );

      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("data-save-status")).toBe("access-lost");
      expect(screen.getByText("editorToolbar.accessLost")).toBeTruthy();
      expect(screen.queryByText("settings.saveFailed")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "settings.retry" }));
      expect(retry).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("button", { name: "settings.reload" }),
      ).toBeTruthy();
    },
  );

  it("does not offer retry without retained operations", () => {
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        saveFailed
        saveError={{ errorCode: "slide_content_conflict", retryable: false }}
        onRetrySave={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "settings.retry" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "settings.reload" }),
    ).toBeTruthy();
  });

  it("keeps the typed failure visible and reports a failed explicit retry", async () => {
    toastError.mockClear();
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        saveFailed
        saveError={{
          errorCode: "network_error",
          retryable: true,
        }}
        onRetrySave={vi.fn().mockRejectedValue(new Error("validation failed"))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "settings.retry" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("settings.saveFailed"),
    );
    expect(screen.getByRole("alert").getAttribute("data-save-error-code")).toBe(
      "network_error",
    );
  });

  it("shows both versions in plain words and hides the error code and reload", async () => {
    deckState.contentConflicts = [
      {
        slideId: "b",
        localContent: "<p>mine</p>",
        remoteContent: "<p>theirs</p>",
        canResolve: true,
      },
    ];
    deckState.resolveDeckContentConflict.mockResolvedValue({
      status: "resolved",
      content: "<p>mine</p>",
    });
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        saveFailed
        saveError={{ errorCode: "slide_content_conflict", retryable: false }}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByText(/slide_content_conflict/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "settings.reload" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.reviewConflict" }),
    );
    expect(
      await screen.findByText(
        'editorToolbar.conflictTitleSomeone {"number":2}',
      ),
    ).toBeTruthy();
    const previews = screen.getAllByTestId("slide-preview");
    expect(previews.map((node) => node.textContent)).toEqual([
      "<p>mine</p>|",
      "<p>theirs</p>|",
    ]);
    expect(
      screen.getByRole("button", {
        name: "editorToolbar.conflictKeepTheirVersion",
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.conflictKeepMyVersion",
      }),
    );

    await waitFor(() =>
      expect(deckState.resolveDeckContentConflict).toHaveBeenCalledWith(
        "deck-1",
        "b",
        "keep-mine",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("names the agent when the other version is the agent's write", async () => {
    deckState.contentConflicts = [
      {
        slideId: "a",
        localContent: "<p>mine</p>",
        remoteContent: "<p>agent</p>",
        canResolve: true,
      },
    ];
    deckState.agentContent = "<p>agent</p>";
    render(<SaveStatusIndicator deckId="deck-1" saving={false} />);

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.reviewConflict" }),
    );
    expect(
      await screen.findByText('editorToolbar.conflictTitleAgent {"number":1}'),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "editorToolbar.conflictKeepAgentVersion",
      }),
    ).toBeTruthy();
  });

  it("keeps the conflict open and reports failure when resolution is rejected", async () => {
    deckState.contentConflicts = [
      {
        slideId: "b",
        localContent: "<p>mine</p>",
        remoteContent: "<p>theirs</p>",
        canResolve: true,
      },
    ];
    deckState.resolveDeckContentConflict.mockResolvedValue({
      status: "unresolved",
      reason: "conflict",
    });
    render(<SaveStatusIndicator deckId="deck-1" saving={false} />);

    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.reviewConflict" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "editorToolbar.conflictKeepTheirVersion",
      }),
    );

    expect(
      await screen.findByText("editorToolbar.conflictResolveFailed"),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reviews a speaker notes conflict as both texts", async () => {
    deckState.fieldConflicts = [
      {
        slideId: "c",
        field: "notes",
        localValue: "My notes",
        remoteValue: "Their notes",
      },
    ];
    deckState.resolveDeckFieldConflict.mockResolvedValue({
      status: "resolved",
    });
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        saveFailed
        saveError={{ errorCode: "slide_field_conflict", retryable: false }}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByText(/slide_field_conflict/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "settings.reload" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.reviewConflict" }),
    );
    expect(
      await screen.findByText(
        'editorToolbar.conflictNotesTitleSomeone {"number":3}',
      ),
    ).toBeTruthy();
    expect(screen.getByText("My notes")).toBeTruthy();
    expect(screen.getByText("Their notes")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "editorToolbar.conflictKeepTheirVersion",
      }),
    );
    await waitFor(() =>
      expect(deckState.resolveDeckFieldConflict).toHaveBeenCalledWith(
        "deck-1",
        "c",
        "notes",
        "use-latest",
      ),
    );
  });

  it("keeps an unresolved full-deck draft visible and offers a backup", async () => {
    deckState.contentConflicts = [
      { slideId: "a", localContent: "<p>a</p>", canResolve: false },
    ];
    const downloadBackup = vi.fn();
    render(
      <SaveStatusIndicator
        deckId="deck-1"
        saving={false}
        onDownloadBackup={downloadBackup}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "editorToolbar.downloadBackup" }),
    );
    expect(downloadBackup).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "editorToolbar.reviewConflict" }),
    ).toBeNull();
  });
});
