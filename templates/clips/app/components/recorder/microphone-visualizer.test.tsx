// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "clipsFinalRaw.selectedMicrophoneWaveform":
        "translated:microphone-waveform",
      "preRecord.noAudio": "translated:no-audio",
      "microphoneVisualizer.needsAttention": "translated:check-mic",
      "microphoneVisualizer.signal": "translated:mic-signal",
      "microphoneVisualizer.listening": "translated:mic-listening",
      "microphoneVisualizer.opening": "translated:mic-opening",
      "microphoneVisualizer.permissionBlockedBrowser":
        "translated:mic-permission-blocked",
      "microphoneVisualizer.notFound": "translated:mic-not-found",
      "microphoneVisualizer.disconnected": "translated:mic-disconnected",
    })[key] ?? key,
}));

import { MicrophoneVisualizer } from "./microphone-visualizer";

class MockTrack extends EventTarget {
  stop = vi.fn();
}

function createStream(track = new MockTrack()) {
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe("MicrophoneVisualizer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sample = 128;
  let track: MockTrack;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let permissionState: PermissionState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => Date.now(),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    track = new MockTrack();
    getUserMedia = vi.fn().mockResolvedValue(createStream(track));
    permissionState = "granted";
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn().mockImplementation(async () => ({
          state: permissionState,
        })),
      },
    });

    class MockAudioContext {
      state: AudioContextState = "running";

      createAnalyser() {
        return {
          fftSize: 512,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (data: Uint8Array) => data.fill(sample),
        };
      }

      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }

      close = vi.fn().mockImplementation(async () => {
        this.state = "closed";
      });

      resume = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal("AudioContext", MockAudioContext);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function renderVisualizer(
    props: Partial<React.ComponentProps<typeof MicrophoneVisualizer>> = {},
  ) {
    await act(async () => {
      root.render(<MicrophoneVisualizer deviceId={null} {...props} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("stays flat and never requests access before the microphone is unlocked", async () => {
    await renderVisualizer();

    const bars = container.querySelectorAll(
      '[data-microphone-visualizer="inline"] i',
    );
    expect(bars).toHaveLength(14);
    expect(
      Array.from(bars).every(
        (bar) => (bar as HTMLElement).style.height === "3px",
      ),
    ).toBe(true);
    expect(container.querySelector("button")).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("auto-starts inline monitoring only after access is unlocked", async () => {
    await renderVisualizer();
    expect(getUserMedia).not.toHaveBeenCalled();

    await renderVisualizer({ unlocked: true });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "translated:mic-listening",
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows a compact loading status while an unlocked device opens", async () => {
    getUserMedia.mockReturnValue(new Promise(() => {}));
    await renderVisualizer({ unlocked: true });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:mic-opening",
    );
    expect(container.querySelector('[role="status"] svg')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("holds silence exactly flat before showing inline attention", async () => {
    sample = 128;
    await renderVisualizer({ unlocked: true });

    await act(async () => vi.advanceTimersByTime(1_000));
    const restingBars = container.querySelectorAll(
      '[data-microphone-visualizer="inline"] i',
    );
    expect(restingBars).toHaveLength(14);
    expect(
      Array.from(restingBars).every(
        (bar) => (bar as HTMLElement).style.height === "3px",
      ),
    ).toBe(true);
    expect(container.textContent).toContain("translated:mic-listening");
    expect(container.textContent).not.toContain("translated:no-audio");

    await act(async () => vi.advanceTimersByTime(4_100));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("translated:no-audio");
    expect(status?.querySelector("svg")).not.toBeNull();
  });

  it("keeps audible input live and clears a silence warning", async () => {
    sample = 128;
    await renderVisualizer({ unlocked: true });
    await act(async () => vi.advanceTimersByTime(5_100));
    expect(container.textContent).toContain("translated:no-audio");

    sample = 180;
    await act(async () => vi.advanceTimersByTime(20));
    expect(container.textContent).toContain("translated:mic-signal");
    expect(container.textContent).not.toContain("translated:no-audio");
  });

  it("reports failures to the row without adding its own error panel", async () => {
    const onStatusChange = vi.fn();
    permissionState = "denied";
    await renderVisualizer({ unlocked: true, onStatusChange });

    expect(onStatusChange).toHaveBeenLastCalledWith("error", {
      error: "translated:mic-permission-blocked",
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:check-mic",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();

    permissionState = "granted";
    getUserMedia.mockRejectedValue(
      Object.assign(new Error("No devices found"), { name: "NotFoundError" }),
    );
    await renderVisualizer({
      deviceId: "missing-mic",
      unlocked: true,
      onStatusChange,
    });
    expect(onStatusChange).toHaveBeenLastCalledWith("error", {
      error: "translated:mic-not-found",
    });
  });

  it("reports a microphone that disconnects during live monitoring", async () => {
    const onStatusChange = vi.fn();
    await renderVisualizer({ unlocked: true, onStatusChange });

    await act(async () => track.dispatchEvent(new Event("ended")));
    expect(onStatusChange).toHaveBeenLastCalledWith("error", {
      error: "translated:mic-disconnected",
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:check-mic",
    );
  });
});
