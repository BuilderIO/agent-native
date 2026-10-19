import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getCurrentRequestBrowserTabId: vi.fn(),
  readAppStateForCurrentTab: vi.fn(),
  compareAndSetAppStateForCurrentTab: vi.fn(),
  appState: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock("./_tab-state.js", () => ({
  getCurrentRequestBrowserTabId: mocks.getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
  compareAndSetAppStateForCurrentTab: mocks.compareAndSetAppStateForCurrentTab,
}));

import action from "./control-deck-history.js";

const input = {
  deckId: "deck-1",
  operation: "undo" as const,
  commandId: "command_123456",
  editorSessionId: "editor_session_1",
  historyVersion: 7,
};

function setStatus(overrides: Record<string, unknown> = {}) {
  mocks.appState.set("slides-2:deck-history-status", {
    protocolVersion: 1,
    deckId: input.deckId,
    editorSessionId: input.editorSessionId,
    historyVersion: input.historyVersion,
    canUndo: true,
    canRedo: false,
    ...overrides,
  });
}

describe("control-deck-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appState.clear();
    mocks.assertAccess.mockResolvedValue({
      resource: { data: JSON.stringify({ appId: "slides-2", slides: [] }) },
    });
    mocks.getCurrentRequestBrowserTabId.mockReturnValue("tab_123");
    mocks.readAppStateForCurrentTab.mockImplementation(
      async (key: string) => mocks.appState.get(key) ?? null,
    );
    mocks.compareAndSetAppStateForCurrentTab.mockImplementation(
      async (
        key: string,
        expected: Record<string, unknown> | null,
        next: Record<string, unknown> | null,
      ) => {
        const current = mocks.appState.get(key) ?? null;
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
        if (next) mocks.appState.set(key, next);
        else mocks.appState.delete(key);
        return true;
      },
    );
    mocks.appState.set("navigation", {
      app: "slides-2",
      view: "editor",
      deckId: input.deckId,
    });
    setStatus();
  });

  it("queues a tab-scoped undo against the current history version", async () => {
    await expect(action.run(input)).resolves.toEqual({
      commandId: input.commandId,
      operation: "undo",
      status: "pending",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.compareAndSetAppStateForCurrentTab).toHaveBeenCalledWith(
      "slides-2:deck-history-command",
      null,
      expect.objectContaining({
        commandId: input.commandId,
        deckId: input.deckId,
        editorSessionId: input.editorSessionId,
        historyVersion: input.historyVersion,
        status: "pending",
      }),
    );
  });

  it("fails closed without the active editor tab or when navigation is stale", async () => {
    mocks.getCurrentRequestBrowserTabId.mockReturnValue(null);
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_tab_required",
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();

    mocks.getCurrentRequestBrowserTabId.mockReturnValue("tab_123");
    mocks.appState.set("navigation", {
      app: "slides-2",
      view: "editor",
      deckId: "deck-2",
    });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_context_stale",
    });
    expect(mocks.compareAndSetAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("rejects stale sessions, versions, and unavailable undo or redo", async () => {
    setStatus({ editorSessionId: "new_editor_session" });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_state_stale",
    });

    setStatus({ historyVersion: input.historyVersion + 1 });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_state_stale",
    });

    setStatus({ canUndo: false });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_command_unavailable",
    });
    expect(mocks.compareAndSetAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("does not replace another pending command and makes exact retries idempotent", async () => {
    mocks.appState.set("slides-2:deck-history-command", {
      protocolVersion: 1,
      commandId: "other_command_123",
      operation: "undo",
      deckId: input.deckId,
      editorSessionId: input.editorSessionId,
      historyVersion: input.historyVersion,
      status: "pending",
    });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_command_pending",
    });

    const completed = {
      protocolVersion: 1,
      ...input,
      status: "applied",
      completedAt: 123,
    };
    mocks.appState.set("slides-2:deck-history-command", completed);
    await expect(action.run(input)).resolves.toEqual({
      commandId: input.commandId,
      operation: input.operation,
      status: "applied",
    });
    expect(mocks.compareAndSetAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("fails on a compare-and-set race or invalid command state", async () => {
    mocks.compareAndSetAppStateForCurrentTab.mockResolvedValueOnce(false);
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_command_conflict",
    });

    mocks.appState.set("slides-2:deck-history-command", { invalid: true });
    await expect(action.run(input)).rejects.toMatchObject({
      errorCode: "deck_history_command_state_invalid",
    });
  });
});
