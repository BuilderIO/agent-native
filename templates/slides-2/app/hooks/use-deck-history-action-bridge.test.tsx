// @vitest-environment happy-dom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  commandVersion: 0,
  pathname: "/deck/deck-1",
  readClientAppState: vi.fn(),
  writeClientAppState: vi.fn(),
  compareAndSetClientAppState: vi.fn(),
  useChangeVersion: vi.fn(),
  useDbSync: vi.fn(),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: mocks.compareAndSetClientAppState,
  readClientAppState: mocks.readClientAppState,
  writeClientAppState: mocks.writeClientAppState,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useChangeVersion: mocks.useChangeVersion,
  useDbSync: mocks.useDbSync,
}));

vi.mock("@/lib/tab-id", () => ({ TAB_ID: "test-tab" }));
vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
}));

import { appStateKey } from "../../shared/app-state-tabs.js";
import {
  DECK_HISTORY_COMMAND_KEY,
  DECK_HISTORY_STATUS_KEY,
} from "../../shared/deck-history-control.js";
import { useDeckHistoryActionBridge } from "./use-deck-history-action-bridge";

const commandKey = `${appStateKey(DECK_HISTORY_COMMAND_KEY)}:test-tab`;
const statusKey = `${appStateKey(DECK_HISTORY_STATUS_KEY)}:test-tab`;

function makeCommand(overrides: Record<string, unknown> = {}) {
  const status = mocks.state.get(statusKey) as Record<string, unknown>;
  return {
    protocolVersion: 1,
    commandId: "command_123456",
    operation: "undo",
    deckId: "deck-1",
    editorSessionId: status.editorSessionId,
    historyVersion: status.historyVersion,
    status: "pending",
    ...overrides,
  };
}

describe("useDeckHistoryActionBridge", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.state.clear();
    mocks.commandVersion = 0;
    mocks.pathname = "/deck/deck-1";
    mocks.useChangeVersion
      .mockReset()
      .mockImplementation(() => mocks.commandVersion);
    mocks.readClientAppState.mockReset().mockImplementation(async (key) => {
      return structuredClone(mocks.state.get(key) ?? null);
    });
    mocks.writeClientAppState
      .mockReset()
      .mockImplementation(async (key, value) => {
        mocks.state.set(key, structuredClone(value));
        return value;
      });
    mocks.compareAndSetClientAppState
      .mockReset()
      .mockImplementation(async (key, expected, next) => {
        const current = mocks.state.get(key) ?? null;
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
        mocks.state.set(key, structuredClone(next));
        return true;
      });
    mocks.useDbSync.mockClear();
  });

  it("runs the current DeckContext undo and acknowledges only after persistence drains", async () => {
    const undo = vi.fn().mockResolvedValue(true);
    const redo = vi.fn().mockResolvedValue(true);
    const flushDeckSave = vi.fn().mockResolvedValue(undefined);
    const props = {
      deckId: "deck-1",
      historyVersion: 4,
      canUndo: true,
      canRedo: false,
      enabled: true,
      undo,
      redo,
      flushDeckSave,
    };
    const { rerender } = renderHook(
      (nextProps) => useDeckHistoryActionBridge(nextProps),
      { initialProps: props },
    );

    await waitFor(() => expect(mocks.state.get(statusKey)).toBeDefined());
    expect(mocks.useDbSync).toHaveBeenCalledWith({
      ignoreSource: "test-tab",
      realtime: { reason: "apply agent commands to DeckEditor history" },
      pauseWhenHidden: false,
    });
    mocks.state.set(commandKey, makeCommand());
    mocks.commandVersion += 1;
    rerender(props);

    await waitFor(() =>
      expect(mocks.state.get(commandKey)).toMatchObject({ status: "applied" }),
    );
    expect(undo).toHaveBeenCalledWith("deck-1");
    expect(flushDeckSave).toHaveBeenCalledWith("deck-1");
    expect(redo).not.toHaveBeenCalled();
  });

  it("keeps realtime off outside the private deck editor route", () => {
    mocks.pathname = "/share/public-deck";
    renderHook(() =>
      useDeckHistoryActionBridge({
        deckId: "deck-1",
        historyVersion: 4,
        canUndo: true,
        canRedo: false,
        enabled: true,
        undo: vi.fn().mockResolvedValue(true),
        redo: vi.fn().mockResolvedValue(true),
        flushDeckSave: vi.fn().mockResolvedValue(undefined),
      }),
    );

    expect(mocks.useDbSync).toHaveBeenCalledWith({
      ignoreSource: "test-tab",
      realtime: undefined,
      pauseWhenHidden: false,
    });
  });

  it("rejects a command from a stale editor session without mutating the deck", async () => {
    const undo = vi.fn().mockResolvedValue(true);
    const props = {
      deckId: "deck-1",
      historyVersion: 4,
      canUndo: true,
      canRedo: false,
      enabled: true,
      undo,
      redo: vi.fn().mockResolvedValue(true),
      flushDeckSave: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = renderHook(
      (nextProps) => useDeckHistoryActionBridge(nextProps),
      { initialProps: props },
    );

    await waitFor(() => expect(mocks.state.get(statusKey)).toBeDefined());
    mocks.state.set(
      commandKey,
      makeCommand({ editorSessionId: "stale_editor_session" }),
    );
    mocks.commandVersion += 1;
    rerender(props);

    await waitFor(() =>
      expect(mocks.state.get(commandKey)).toMatchObject({
        status: "rejected",
        failureCode: "stale_editor_state",
      }),
    );
    expect(undo).not.toHaveBeenCalled();
    expect(props.flushDeckSave).not.toHaveBeenCalled();
  });
});
