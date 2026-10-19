// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queue: null as { commands: Array<Record<string, unknown>> } | null,
  queueVersion: 0,
  readClientAppState: vi.fn(),
  compareAndSetClientAppState: vi.fn(),
  callAction: vi.fn(),
  useChangeVersion: vi.fn(),
  useDbSync: vi.fn(),
  send: vi.fn(() => true),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  readClientAppState: mocks.readClientAppState,
  compareAndSetClientAppState: mocks.compareAndSetClientAppState,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Presenter command failed.",
  callAction: mocks.callAction,
  getBrowserTabId: () => "test-tab",
  useChangeVersion: mocks.useChangeVersion,
  useDbSync: mocks.useDbSync,
}));

import { usePresenterActionBridge } from "./use-presenter-action-bridge";

function makeCommand() {
  return {
    commandId: "00000000-0000-4000-8000-000000000001",
    issuedAt: Date.now(),
    deckId: "deck-1",
    operation: "next" as const,
  };
}

let command = makeCommand();

describe("usePresenterActionBridge", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    command = makeCommand();
    mocks.queue = { commands: [] };
    mocks.queueVersion = 0;
    mocks.useChangeVersion
      .mockReset()
      .mockImplementation(() => mocks.queueVersion);
    mocks.readClientAppState
      .mockReset()
      .mockImplementation(async () =>
        mocks.queue === null ? null : structuredClone(mocks.queue),
      );
    mocks.compareAndSetClientAppState
      .mockReset()
      .mockImplementation(async (_key, expected, next) => {
        if (JSON.stringify(mocks.queue) !== JSON.stringify(expected)) {
          return false;
        }
        mocks.queue = structuredClone(next);
        return true;
      });
    mocks.callAction.mockReset();
    mocks.useDbSync.mockClear();
    mocks.send.mockReset().mockReturnValue(true);
  });

  it("drains queue changes through the shared realtime app-state transport", async () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const onSwitchDeck = vi.fn();
    const { rerender } = renderHook(() =>
      usePresenterActionBridge({
        deckId: "deck-1",
        enabled: true,
        send: mocks.send,
        onSwitchDeck,
      }),
    );

    await waitFor(() => expect(mocks.readClientAppState).toHaveBeenCalled());
    expect(mocks.useChangeVersion).toHaveBeenCalledWith(
      "app-state:slides-2:presenter-control-queue",
    );
    expect(mocks.useDbSync).toHaveBeenLastCalledWith({
      ignoreSource: expect.any(String),
      realtime: { reason: "relay queued presenter commands from other tabs" },
      pauseWhenHidden: false,
    });

    mocks.queue = { commands: [command] };
    mocks.queueVersion += 1;
    rerender();

    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith({ type: "next" }),
    );
    expect(mocks.queue).toEqual({ commands: [] });
    expect(setInterval.mock.calls.some(([, delay]) => delay === 250)).toBe(
      false,
    );
    setInterval.mockRestore();
  });

  it("restores a claimed command when the live projection cannot receive it", async () => {
    mocks.send.mockReturnValue(false);
    const onSwitchDeck = vi.fn();
    mocks.callAction.mockImplementation(async () => {
      mocks.queue = { commands: [command] };
      return command;
    });
    const { result } = renderHook(() =>
      usePresenterActionBridge({
        deckId: "deck-1",
        enabled: true,
        send: mocks.send,
        onSwitchDeck,
      }),
    );

    await waitFor(() => expect(mocks.readClientAppState).toHaveBeenCalled());
    let relayed: boolean | undefined;
    await act(async () => {
      relayed = await result.current.run({
        deckId: "deck-1",
        operation: "next",
      });
    });

    expect(relayed).toBe(false);
    expect(mocks.queue).toEqual({ commands: [command] });
    expect(result.current.errorMessage).toBe(
      "Presenter command could not reach the live projection.",
    );
  });
});
