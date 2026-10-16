// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const emitted: Array<{ name: string; payload?: unknown }> = [];
  const listeners = new Map<string, (event: { payload?: unknown }) => void>();
  return {
    emitted,
    listeners,
    emit: vi.fn(async (name: string, payload?: unknown) => {
      emitted.push({ name, payload });
    }),
    invoke: vi.fn(async () => undefined),
    writeText: vi.fn(async () => undefined),
  };
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: mocks.emit,
  listen: vi.fn(
    (name: string, listener: (event: { payload?: unknown }) => void) => {
      mocks.listeners.set(name, listener);
      return Promise.resolve(() => mocks.listeners.delete(name));
    },
  ),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mocks.writeText,
}));
vi.mock("../components/live-waveform", () => ({ LiveWaveform: () => null }));

import { FlowBar } from "./flow-bar";

describe("FlowBar recovery dismissal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.emitted.length = 0;
    mocks.listeners.clear();
    mocks.emit.mockClear();
    mocks.invoke.mockClear().mockResolvedValue(undefined);
    mocks.writeText.mockClear().mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<FlowBar />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const onStateChange = mocks.listeners.get("voice:state-change");
    expect(onStateChange).toBeDefined();
    await act(async () => {
      onStateChange?.({
        payload: {
          state: "error",
          runId: 123,
          failure: "history-save",
          recoverable: true,
          historySaved: false,
          retryHistory: true,
          transcript: "recovered words",
        },
      });
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps retry state after copy and emits a run-scoped dismiss from X", async () => {
    const copy = host.querySelector<HTMLButtonElement>(".flow-bar-copy-action");
    expect(copy).not.toBeNull();
    await act(async () => {
      copy?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.writeText).toHaveBeenCalledWith("recovered words");
    expect(mocks.emit).not.toHaveBeenCalledWith(
      "voice:dismiss-recovery",
      expect.anything(),
    );
    expect(
      host.querySelectorAll(".flow-bar-recovery-actions .flow-bar-action"),
    ).toHaveLength(2);

    const dismiss = host.querySelector<HTMLButtonElement>(
      ".flow-bar-error-heading .flow-bar-dismiss",
    );
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.emit).toHaveBeenCalledWith("voice:dismiss-recovery", {
      runId: 123,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("hide_flow_bar");
  });
});
