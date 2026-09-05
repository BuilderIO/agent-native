// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { size?: string }) =>
    ({
      "cameraVisualizer.bubble": "translated:camera-bubble",
      "cameraVisualizer.live": "translated:camera-live",
      "cameraVisualizer.waiting": "translated:camera-waiting",
      "cameraVisualizer.opening": "translated:camera-opening",
      "cameraVisualizer.stop": "translated:camera-stop",
      "cameraVisualizer.test": "translated:camera-test",
      "cameraVisualizer.selectedPreview": "translated:selected-preview",
      "cameraVisualizer.preview": "translated:camera-preview",
      "cameraVisualizer.setBubbleSize": `translated:camera-size-${values?.size ?? ""}`,
      "cameraVisualizer.needsAttention": "translated:check-camera",
      "cameraVisualizer.permissionBlocked":
        "translated:camera-permission-blocked",
      "cameraVisualizer.notFound": "translated:camera-not-found",
      "cameraVisualizer.disconnected": "translated:camera-disconnected",
      "cameraVisualizer.noVideo": "translated:camera-no-video",
      "preRecord.cameraOff": "translated:camera-off",
    })[key] ?? key,
}));

vi.mock("@/lib/camera-blur", () => ({
  DEFAULT_BLUR_PX: 18,
  createBackgroundBlurStream: vi.fn(),
}));

import { CameraVisualizer } from "./camera-visualizer";

class MockTrack extends EventTarget {
  stop = vi.fn();
}

function createStream(track = new MockTrack()) {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

describe("CameraVisualizer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let track: MockTrack;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let permissionState: PermissionState;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const mediaSources = new WeakMap<HTMLMediaElement, MediaStream | null>();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get(this: HTMLMediaElement) {
        return mediaSources.get(this) ?? null;
      },
      set(this: HTMLMediaElement, value: MediaStream | null) {
        mediaSources.set(this, value);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });

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
    props: Partial<React.ComponentProps<typeof CameraVisualizer>> = {},
  ) {
    await act(async () => {
      root.render(<CameraVisualizer deviceId={null} {...props} />);
      await Promise.resolve();
    });
  }

  async function startTest() {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "translated:camera-test",
    );
    if (!button) throw new Error("Expected translated camera test button");
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("keeps the disabled state explicit without requesting a device", async () => {
    await renderVisualizer({ disabled: true });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:camera-off",
    );
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "translated:camera-test",
      )?.disabled,
    ).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("shows stable loading and live-preview states", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      }),
    );
    await renderVisualizer();

    const testButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "translated:camera-test",
    );
    await act(async () => {
      testButton?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:camera-opening",
    );
    expect(testButton?.disabled).toBe(true);

    await act(async () => {
      resolveStream?.(createStream(track));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:camera-waiting",
    );

    const video = container.querySelector("video");
    await act(async () => video?.dispatchEvent(new Event("loadeddata")));
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:camera-live",
    );
  });

  it("turns a camera that never supplies a frame into a compact error", async () => {
    await renderVisualizer();
    await startTest();

    await act(async () => vi.advanceTimersByTime(5_000));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "translated:camera-no-video",
    );
    expect(
      container.querySelector('[role="status"]')?.querySelector("svg"),
    ).not.toBeNull();
    expect(track.stop).toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "translated:camera-test",
      ),
    ).toBe(true);
  });

  it("turns playback rejection into a retryable no-video error", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException("Unable to play media", "NotSupportedError"),
    );
    await renderVisualizer();
    await startTest();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:check-camera",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "translated:camera-no-video",
    );
    expect(track.stop).toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "translated:camera-test",
      ),
    ).toBe(true);
  });

  it("turns a media error into the same retryable no-video state", async () => {
    await renderVisualizer();
    await startTest();

    await act(async () => {
      container.querySelector("video")?.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "translated:check-camera",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "translated:camera-no-video",
    );
    expect(track.stop).toHaveBeenCalled();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "translated:camera-test",
      ),
    ).toBe(true);
  });

  it("makes denied and missing-device failures actionable", async () => {
    permissionState = "denied";
    await renderVisualizer();
    await startTest();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "translated:camera-permission-blocked",
    );

    permissionState = "granted";
    getUserMedia.mockRejectedValue(
      Object.assign(new Error("No devices found"), { name: "NotFoundError" }),
    );
    await startTest();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "translated:camera-not-found",
    );
  });

  it("reports a camera that disconnects during a live check", async () => {
    await renderVisualizer();
    await startTest();

    await act(async () => track.dispatchEvent(new Event("ended")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "translated:camera-disconnected",
    );
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "translated:camera-test",
      ),
    ).toBeDefined();
  });

  it("keeps one preview inline when narrow and fixed at roomy widths", async () => {
    await renderVisualizer({ size: "lg" });
    await startTest();

    const preview = container.querySelector<HTMLElement>(
      '[data-testid="camera-preview-container"]',
    );
    expect(preview).not.toBeNull();
    expect(preview?.className).toContain("relative");
    expect(preview?.className).toContain("w-full");
    expect(preview?.className).toContain("max-w-[var(--camera-preview-size)]");
    expect(preview?.className).toContain("min-[900px]:fixed");
    expect(preview?.className).toContain("min-[900px]:start-4");
    expect(preview?.style.getPropertyValue("--camera-preview-size")).toBe(
      "320px",
    );
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(
      container.querySelectorAll('[aria-label="translated:camera-bubble"]'),
    ).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "translated:camera-stop",
      ),
    ).toBe(true);
  });
});
