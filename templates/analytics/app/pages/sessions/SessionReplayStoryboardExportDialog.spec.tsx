// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureReplayScreenshot: vi.fn(),
  fetchSessionReplayPlayback: vi.fn(),
  getIdToken: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => `/api/${path}`,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/auth", () => ({ getIdToken: mocks.getIdToken }));
vi.mock("./session-replay-screenshot", () => ({
  captureReplayScreenshot: mocks.captureReplayScreenshot,
  ReplayScreenshotAssetError: class ReplayScreenshotAssetError extends Error {},
}));
vi.mock("./SessionDetailPage", () => ({
  REPLAY_OVERLAY_STYLE_RULES: "",
  buildReplayViewportTimeline: () => [],
  fetchSessionReplayPlayback: mocks.fetchSessionReplayPlayback,
  normalizeReplayEvents: (events: unknown[]) => events,
  replayAvailabilityErrorKey: () => null,
  replayInitialViewportDimensions: () => ({ width: 430, height: 932 }),
  replayRouteAtOffset: () => "/library",
  replayViewportDimensionsAtTime: () => null,
}));
vi.mock("@rrweb/replay", () => ({
  Replayer: class {
    iframe = document.createElement("iframe");

    constructor(_events: unknown[], { root }: { root: HTMLElement }) {
      root.appendChild(this.iframe);
    }

    getMetaData() {
      return { totalTime: 60_000 };
    }

    play() {}
    pause() {}
    destroy() {}
  },
}));
vi.mock("@tabler/icons-react", () => ({
  IconPhoto: () => null,
  IconPlayerStop: () => null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

import { SessionReplayStoryboardExportDialog } from "./SessionReplayStoryboardExportDialog";

describe("SessionReplayStoryboardExportDialog screenshot capture", () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousMediaDevices: PropertyDescriptor | undefined;
  const getDisplayMedia = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    previousMediaDevices = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia },
    });
    mocks.captureReplayScreenshot.mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    mocks.fetchSessionReplayPlayback.mockResolvedValue({
      isComplete: true,
      unavailableChunks: 0,
      chunks: [{ events: [{ type: 4 }] }],
      recording: { eventCount: 12 },
    });
    mocks.getIdToken.mockResolvedValue("test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          response: "Added 1 screenshot to Design.",
          boardUrl: "https://design.example.test/board",
        }),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (previousMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", previousMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("captures the replay through the shared screenshot helper without screen sharing", async () => {
    await act(async () => {
      root.render(
        <SessionReplayStoryboardExportDialog
          open
          onOpenChange={() => {}}
          cohortTotal={1}
          recordings={[
            {
              id: "replay-1",
              startedAt: "2026-10-08T11:22:27.000Z",
              durationMs: 60_000,
              eventCount: 12,
              app: "clips",
              template: "clips",
              path: "/library",
            },
          ]}
        />,
      );
    });

    const timestampInput = container.querySelector<HTMLInputElement>(
      "#storyboard-offsets-replay-1",
    );
    expect(timestampInput).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(timestampInput, "00:13");
      timestampInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await vi.waitFor(() =>
        expect(mocks.captureReplayScreenshot).toHaveBeenCalledTimes(1),
      );
    });

    expect(mocks.captureReplayScreenshot).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.any(HTMLDivElement),
      expect.any(HTMLIFrameElement),
      expect.any(AbortSignal),
    );
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(container.textContent).toContain("sessions.storyboardComplete");
  });
});
