// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
}));

import { AgentCompletionSound } from "./AgentCompletionSound";

class FakeAudio {
  static instances: FakeAudio[] = [];
  volume = 1;
  play = vi.fn(async () => undefined);

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }
}

describe("AgentCompletionSound", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    FakeAudio.instances = [];
    mocks.useActionQuery.mockReturnValue({ data: {}, isError: false });
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("plays the bell once when a run finishes", async () => {
    await act(async () => {
      root.render(<AgentCompletionSound />);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "run-1" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "run-1" },
        }),
      );
    });

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("/agent-completion.mp3");
    expect(FakeAudio.instances[0].volume).toBe(0.5);
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce();
  });

  it("does not play when the setting is disabled", async () => {
    mocks.useActionQuery.mockReturnValue({
      data: { bellSoundEnabled: false },
      isError: false,
    });

    await act(async () => {
      root.render(<AgentCompletionSound />);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "run-2" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "run-2" },
        }),
      );
    });

    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("does not play for an auto-recovered or failed run", async () => {
    await act(async () => {
      root.render(<AgentCompletionSound />);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "run-3" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:auto-continue", {
          detail: { tabId: "run-3" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "run-3" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "run-4" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: { tabId: "run-4" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, reason: "failed", tabId: "run-4" },
        }),
      );
    });

    expect(FakeAudio.instances).toHaveLength(0);
  });
});
