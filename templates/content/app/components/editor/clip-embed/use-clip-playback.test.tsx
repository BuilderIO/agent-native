// @vitest-environment happy-dom

import type { ClipPlayback } from "@shared/clips-peer-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useClipMarkers,
  useClipPlayback,
  type ClipMarkersState,
  type ClipPlaybackState,
} from "./use-clip-playback";

type FakeQuery = {
  data: unknown;
  isError: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
};

const queries = vi.hoisted(() => ({
  byName: {} as Record<string, FakeQuery>,
  options: {} as Record<string, Record<string, unknown> | undefined>,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    _params: unknown,
    options?: Record<string, unknown>,
  ) => {
    queries.options[name] = options;
    return queries.byName[name];
  },
}));

const T0 = Date.parse("2026-10-23T12:00:00.000Z");

function grant(n: number, overrides?: Partial<ClipPlayback["playback"]>) {
  return {
    recording: {
      id: "rec_1",
      title: "Demo",
      kind: "video",
      status: "ready",
      durationMs: 12_000,
      width: 1280,
      height: 720,
      enableComments: true,
      embedProvider: null,
    },
    playback: {
      videoUrl: `https://clips.example.test/api/video/rec_1?cg=${n}`,
      posterUrl: null,
      expiresAt: new Date(T0 + n * 5 * 60_000).toISOString(),
      ...overrides,
    },
    viewer: { isOwner: false, canComment: true },
  } satisfies ClipPlayback;
}

function fakeQuery(data?: unknown): FakeQuery {
  return { data, isError: false, error: null, refetch: vi.fn() };
}

let root: Root | null = null;
let latest: ClipPlaybackState | null = null;
let latestMarkers: ClipMarkersState | null = null;

function Probe({ commentsOn = true }: { commentsOn?: boolean }) {
  latest = useClipPlayback("doc_1", "rec_1");
  latestMarkers = useClipMarkers("doc_1", "rec_1", commentsOn);
  return null;
}

function render(props?: { commentsOn?: boolean }) {
  act(() => root!.render(<Probe {...props} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  queries.byName = {
    "get-clip-playback": fakeQuery(grant(1)),
    "list-clip-comments": fakeQuery({ markers: [] }),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
  latestMarkers = null;
  vi.useRealTimers();
});

const playbackQuery = () => queries.byName["get-clip-playback"]!;

describe("useClipPlayback", () => {
  it("stays on its grant while later answers arrive", () => {
    render();
    expect(latest?.grant).toEqual(grant(1));
    playbackQuery().data = grant(2);
    render();
    expect(latest?.grant?.playback.videoUrl).toBe(grant(1).playback.videoUrl);
  });

  it("asks again before the grant runs out, then waits for the next one", async () => {
    playbackQuery().refetch.mockResolvedValue({
      isError: false,
      data: grant(2),
    });
    render();

    await act(() => vi.advanceTimersByTimeAsync(4 * 60_000 + 29_000));
    expect(playbackQuery().refetch).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);

    // grant(2) runs until T0 + 10 min.
    await act(() => vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(2);
    expect(latest?.error).toBeNull();
  });

  it("refreshes once after a media error, and gives up if the new source fails too", async () => {
    playbackQuery().refetch.mockResolvedValue({
      isError: false,
      data: grant(2),
    });
    render();

    await act(async () => latest!.onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();

    await act(async () => latest!.onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.error).toBe("unplayable");
  });

  it("gives a source from a later refresh its own retry", async () => {
    playbackQuery()
      .refetch.mockResolvedValueOnce({ isError: false, data: grant(2) })
      .mockResolvedValueOnce({ isError: false, data: grant(3) })
      .mockResolvedValueOnce({ isError: false, data: grant(4) });
    render();

    await act(async () => latest!.onMediaError());
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(latest?.grant?.playback.videoUrl).toBe(grant(3).playback.videoUrl);
    await act(async () => latest!.onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);
    expect(latest?.error).toBeNull();
  });

  it("shows a failed refresh as its own error and stops asking", async () => {
    playbackQuery().refetch.mockResolvedValue({
      isError: true,
      data: undefined,
      error: new Error("network down"),
    });
    render();

    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(latest?.error).toBe("refresh_failed");
    await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the reason a refresh was refused", async () => {
    playbackQuery().refetch.mockResolvedValue({
      isError: true,
      data: undefined,
      error: Object.assign(new Error("gone"), { errorCode: "clip_expired" }),
    });
    render();

    await act(async () => latest!.onMediaError());
    expect(latest?.error).toBe("clip_expired");
  });

  it.each([
    ["clips_not_configured", "clips_not_configured"],
    ["clip_password_required", "clip_password_required"],
    [undefined, "failed"],
  ])("reports a first load refused with %s as %s", (code, expected) => {
    queries.byName["get-clip-playback"] = {
      ...fakeQuery(),
      isError: true,
      error: Object.assign(new Error("refused"), { errorCode: code }),
    };
    render();
    expect(latest).toMatchObject({
      grant: null,
      loading: false,
      error: expected,
    });
  });

  it("plays the grant a retry brings back, not the one that failed", async () => {
    let answer!: (result: unknown) => void;
    playbackQuery()
      .refetch.mockResolvedValueOnce({
        isError: true,
        error: new Error("down"),
      })
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    render();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(latest?.error).toBe("refresh_failed");

    act(() => latest!.retry());
    expect(latest).toMatchObject({ grant: null, loading: true, error: null });
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(2);

    await act(async () => answer({ isError: false, data: grant(2) }));
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();
  });

  it("keeps showing a retry that fails again", async () => {
    playbackQuery()
      .refetch.mockResolvedValueOnce({
        isError: true,
        error: new Error("down"),
      })
      .mockResolvedValueOnce({
        isError: true,
        error: Object.assign(new Error("down"), {
          errorCode: "clips_unreachable",
        }),
      });
    render();
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));

    await act(async () => latest!.retry());
    expect(latest?.error).toBe("clips_unreachable");
  });

  it("gives a source that failed after a refresh another chance on retry", async () => {
    playbackQuery()
      .refetch.mockResolvedValueOnce({ isError: false, data: grant(2) })
      .mockResolvedValueOnce({ isError: false, data: grant(3) });
    render();
    await act(async () => latest!.onMediaError());
    await act(async () => latest!.onMediaError());
    expect(latest?.error).toBe("unplayable");

    await act(async () => latest!.retry());
    expect(latest?.grant?.playback.videoUrl).toBe(grant(3).playback.videoUrl);
    expect(latest?.error).toBeNull();
  });

  it("never swaps a YouTube Clip's player on a timer", async () => {
    queries.byName["get-clip-playback"] = fakeQuery(
      grant(1, { videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" }),
    );
    render();
    await act(() => vi.advanceTimersByTimeAsync(60 * 60_000));
    expect(playbackQuery().refetch).not.toHaveBeenCalled();
  });
});

describe("useClipMarkers", () => {
  it("asks for nothing and shows nothing while the Clip's comments are off", () => {
    render({ commentsOn: false });
    expect(latestMarkers).toEqual({ status: "off" });
    expect(queries.options["list-clip-comments"]?.enabled).toBe(false);
  });

  it("returns the comment threads", () => {
    const markers = [
      { id: "c1", videoTimestampMs: 4_000, content: "Hi", authorName: "Ada" },
    ];
    queries.byName["list-clip-comments"] = fakeQuery({ markers });
    render();
    expect(latestMarkers).toEqual({ status: "ready", markers });
  });

  it("treats comments turned off since the grant as off, not as a failure", () => {
    queries.byName["list-clip-comments"] = {
      ...fakeQuery(),
      isError: true,
      error: Object.assign(new Error("off"), {
        errorCode: "clip_comments_disabled",
      }),
    };
    render();
    expect(latestMarkers).toEqual({ status: "off" });
  });

  it("tells a failed comment list apart from an empty one", () => {
    queries.byName["list-clip-comments"] = {
      ...fakeQuery(),
      isError: true,
      error: Object.assign(new Error("down"), {
        errorCode: "clips_unreachable",
      }),
    };
    render();
    expect(latestMarkers).toEqual({ status: "failed", markers: [] });

    queries.byName["list-clip-comments"] = fakeQuery();
    render();
    expect(latestMarkers).toEqual({ status: "loading" });
  });

  it("reports a failed refetch while keeping the markers it already had", () => {
    const markers = [
      { id: "c1", videoTimestampMs: 4_000, content: "Hi", authorName: "Ada" },
    ];
    queries.byName["list-clip-comments"] = {
      ...fakeQuery({ markers }),
      isError: true,
      error: Object.assign(new Error("down"), {
        errorCode: "clips_unreachable",
      }),
    };
    render();
    expect(latestMarkers).toEqual({ status: "failed", markers });
  });
});
