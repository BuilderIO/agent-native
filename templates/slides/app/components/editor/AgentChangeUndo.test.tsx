// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChange } from "@/context/DeckContext";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(change: AgentChange) => void>(),
  undoAgentChange: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/context/DeckContext", () => ({
  useDecks: () => ({
    subscribeAgentChanges: (listener: (change: AgentChange) => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
    undoAgentChange: mocks.undoAgentChange,
  }),
}));

import { AgentChangeUndo } from "./AgentChangeUndo";

function announce(change: AgentChange) {
  act(() => {
    for (const listener of mocks.listeners) listener(change);
  });
}

function toastUndo() {
  const options = mocks.toast.mock.calls.at(-1)?.[1] as
    | { action?: { onClick: () => void } }
    | undefined;
  if (!options?.action) throw new Error("toast has no Undo action");
  return options.action.onClick;
}

beforeEach(() => {
  mocks.listeners.clear();
  mocks.undoAgentChange.mockReset();
  mocks.toast.mockReset();
  mocks.toast.error.mockReset();
});

afterEach(cleanup);

describe("AgentChangeUndo", () => {
  it("shows one toast per run for this deck with an Undo action", async () => {
    mocks.undoAgentChange.mockResolvedValue("undone");
    render(<AgentChangeUndo deckId="deck-1" />);

    announce({ deckId: "other-deck", token: "t0", slideCount: 1 });
    expect(mocks.toast).not.toHaveBeenCalled();
    announce({ deckId: "deck-1", token: "t1", slideCount: 3 });

    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.toast.mock.calls[0]?.[0]).toBe(
      'deckEditor.agentUpdatedSlides {"count":3}',
    );
    act(() => toastUndo()());
    await waitFor(() =>
      expect(mocks.undoAgentChange).toHaveBeenCalledWith("deck-1", "t1"),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before replacing later edits and overwrites only on confirm", async () => {
    mocks.undoAgentChange
      .mockResolvedValueOnce("conflict")
      .mockResolvedValueOnce("undone");
    render(<AgentChangeUndo deckId="deck-1" />);
    announce({ deckId: "deck-1", token: "t1", slideCount: 1 });

    act(() => toastUndo()());
    expect(
      await screen.findByText("deckEditor.agentUndoConflictTitle"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("deckEditor.agentUndoConfirm"));

    await waitFor(() =>
      expect(mocks.undoAgentChange).toHaveBeenLastCalledWith("deck-1", "t1", {
        overwrite: true,
      }),
    );
  });
});
