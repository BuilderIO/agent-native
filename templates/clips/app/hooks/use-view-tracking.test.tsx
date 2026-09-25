// @vitest-environment happy-dom

import React, { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useViewTracking } from "./use-view-tracking";

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

interface HarnessProps {
  recordingId: string;
  durationMs: number;
  disabled?: boolean;
  trackOpenWithoutVideo?: boolean;
  withVideo?: boolean;
}

function Harness({ withVideo = true, ...opts }: HarnessProps) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  useViewTracking({
    ...opts,
    videoEl: withVideo ? videoEl : null,
  });
  return withVideo ? <video ref={setVideoEl} /> : null;
}

function viewEventBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/api/view-event"))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe("useViewTracking", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
      ],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      localStorage.clear();
    } catch {}
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function getVideo(): HTMLVideoElement {
    const video = container.querySelector("video");
    if (!video) throw new Error("no <video> rendered");
    return video;
  }

  it("keeps accumulating watch time across unrelated parent rerenders while playing", () => {
    act(() => {
      root.render(<Harness recordingId="rec-a" durationMs={10_000} />);
    });
    const video = getVideo();

    act(() => {
      video.dispatchEvent(new Event("play"));
    });

    // Re-render with the exact same tracked identity (video/recordingId/
    // trackOpenWithoutVideo/disabled unchanged) several times, simulating
    // unrelated parent state updates (e.g. a scrubber position re-render).
    for (let i = 0; i < 5; i++) {
      act(() => {
        root.render(<Harness recordingId="rec-a" durationMs={10_000} />);
      });
    }

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    const bodies = viewEventBodies(fetchMock);
    const progress = bodies.filter((b) => b.kind === "watch-progress");
    expect(progress.length).toBeGreaterThan(0);
    // The heartbeat interval must never have been torn down by the
    // unrelated rerenders, so watch time keeps accumulating past the
    // counted-view threshold.
    expect(progress[progress.length - 1].totalWatchMs).toBeGreaterThanOrEqual(
      4000,
    );
  });

  it("reattaches with a fresh session when the video element is replaced (Edit -> Done)", () => {
    act(() => {
      root.render(<Harness recordingId="rec-a" durationMs={10_000} />);
    });
    let video = getVideo();
    act(() => {
      video.dispatchEvent(new Event("play"));
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // "Edit" — the player (and its <video>) unmounts.
    act(() => {
      root.render(
        <Harness recordingId="rec-a" durationMs={10_000} withVideo={false} />,
      );
    });
    // "Done" — a brand new player/video mounts.
    act(() => {
      root.render(<Harness recordingId="rec-a" durationMs={10_000} />);
    });
    video = getVideo();

    act(() => {
      video.dispatchEvent(new Event("play"));
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    const bodies = viewEventBodies(fetchMock);
    const viewStarts = bodies.filter((b) => b.kind === "view-start");
    // One view-start for the original attach, one for the post-edit remount.
    expect(viewStarts).toHaveLength(2);
    expect(viewStarts[0].viewSessionId).not.toBe(viewStarts[1].viewSessionId);

    const secondSessionProgress = bodies.filter(
      (b) =>
        b.kind === "watch-progress" &&
        b.viewSessionId === viewStarts[1].viewSessionId,
    );
    expect(secondSessionProgress.length).toBeGreaterThan(0);
    // The new session must not start with the old session's watch time
    // already counted.
    expect(secondSessionProgress[0].totalWatchMs).toBeLessThan(6000);
  });

  it("flushes the outgoing recording's own id when recordingId changes on a reused video element", () => {
    act(() => {
      root.render(<Harness recordingId="rec-a" durationMs={10_000} />);
    });
    const video = getVideo();
    act(() => {
      video.dispatchEvent(new Event("play"));
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // Same component instance and DOM node persist — only recordingId (and
    // duration) change, simulating a route that reuses the player for a
    // different recording without remounting.
    act(() => {
      root.render(<Harness recordingId="rec-b" durationMs={20_000} />);
    });

    const bodies = viewEventBodies(fetchMock);
    // The final flush triggered by tearing down rec-a's session must still
    // be posted under rec-a, never rec-b.
    const misattributed = bodies.filter(
      (b) => b.kind === "watch-progress" && b.recordingId === "rec-b",
    );
    expect(misattributed).toHaveLength(0);

    const flushesForA = bodies.filter(
      (b) => b.kind === "watch-progress" && b.recordingId === "rec-a",
    );
    expect(flushesForA.length).toBeGreaterThan(0);

    // rec-b gets its own fresh session — playing it posts view-start under
    // rec-b, not rec-a.
    act(() => {
      video.dispatchEvent(new Event("play"));
    });
    const viewStartsForB = viewEventBodies(fetchMock).filter(
      (b) => b.kind === "view-start" && b.recordingId === "rec-b",
    );
    expect(viewStartsForB).toHaveLength(1);
  });

  it("fires the no-video view-start once trackOpenWithoutVideo resolves true (async Loom activation)", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-loom"
          durationMs={0}
          withVideo={false}
          trackOpenWithoutVideo={false}
        />,
      );
    });

    expect(viewEventBodies(fetchMock)).toHaveLength(0);

    // The public-recording query resolves and reveals this is Loom-backed.
    act(() => {
      root.render(
        <Harness
          recordingId="rec-loom"
          durationMs={0}
          withVideo={false}
          trackOpenWithoutVideo
        />,
      );
    });

    const bodies = viewEventBodies(fetchMock);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      kind: "view-start",
      recordingId: "rec-loom",
      payload: { source: "iframe-open" },
    });

    // Further unrelated rerenders with the same resolved value must not
    // re-fire it.
    act(() => {
      root.render(
        <Harness
          recordingId="rec-loom"
          durationMs={0}
          withVideo={false}
          trackOpenWithoutVideo
        />,
      );
    });
    expect(viewEventBodies(fetchMock)).toHaveLength(1);
  });

  it("flushes final watch progress for the correct recording on unmount", () => {
    act(() => {
      root.render(<Harness recordingId="rec-a" durationMs={10_000} />);
    });
    const video = getVideo();
    act(() => {
      video.dispatchEvent(new Event("play"));
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    act(() => {
      root.unmount();
    });

    const bodies = viewEventBodies(fetchMock);
    const flushes = bodies.filter(
      (b) => b.kind === "watch-progress" && b.recordingId === "rec-a",
    );
    expect(flushes.length).toBeGreaterThan(0);
    expect(flushes[flushes.length - 1].totalWatchMs).toBeGreaterThanOrEqual(
      6000,
    );
  });

  it("does not double-post the no-video view-start under StrictMode's dev mount/cleanup/remount cycle", () => {
    act(() => {
      root.render(
        <StrictMode>
          <Harness
            recordingId="rec-strict"
            durationMs={0}
            withVideo={false}
            trackOpenWithoutVideo
          />
        </StrictMode>,
      );
    });

    const bodies = viewEventBodies(fetchMock);
    const viewStarts = bodies.filter((b) => b.kind === "view-start");
    expect(viewStarts).toHaveLength(1);
  });
});
