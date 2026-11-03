// @vitest-environment happy-dom

import type { ClipPlayback } from "@shared/clips-peer-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useClipComments,
  useClipPlayback,
  type ClipCommentsState,
  type ClipPlaybackState,
} from "./use-clip-playback";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

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
let latestComments: ClipCommentsState | null = null;

function Probe({ commentsOn = true }: { commentsOn?: boolean }) {
  latest = useClipPlayback("doc_1", "rec_1");
  latestComments = useClipComments("doc_1", "rec_1", commentsOn);
  return null;
}

function render(props?: { commentsOn?: boolean }) {
  act(() => defined(root).render(<Probe {...props} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  queries.byName = {
    "get-clip-playback": fakeQuery(grant(1)),
    "list-clip-comments": fakeQuery({ threads: [], truncated: false }),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
  latestComments = null;
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.useRealTimers();
});

const playbackQuery = () => defined(queries.byName["get-clip-playback"]);

const down = (errorCode?: string) => ({
  isError: true,
  data: undefined,
  error: Object.assign(new Error("down"), { errorCode }),
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

/**
 * Moves the clock a second at a time, so effects that an answer schedules run
 * before the clock passes their timers, as they would in a browser.
 */
async function elapse(ms: number) {
  for (let done = 0; done < ms; done += 1_000) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(1_000, ms - done)));
  }
}

/** grant(1) runs until T0 + 5 min; every refresh before then fails. */
async function playUntilClipsIsOut() {
  playbackQuery().refetch.mockResolvedValue(down());
  render();
  await elapse(5 * 60_000);
  expect(latest?.error).toBe("refresh_failed");
}

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

    await elapse(4 * 60_000 + 29_000);
    expect(playbackQuery().refetch).not.toHaveBeenCalled();
    await elapse(1_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);

    // grant(2) runs until T0 + 10 min.
    await elapse(4 * 60_000 + 59_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    await elapse(1_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(2);
    expect(latest?.error).toBeNull();
  });

  it("refreshes once after a media error, and gives up if the new source fails too", async () => {
    playbackQuery().refetch.mockResolvedValue({
      isError: false,
      data: grant(2),
    });
    render();

    await act(async () => defined(latest).onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();

    await act(async () => defined(latest).onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.error).toBe("unplayable");
  });

  it("gives a source from a later refresh its own retry", async () => {
    playbackQuery()
      .refetch.mockResolvedValueOnce({ isError: false, data: grant(2) })
      .mockResolvedValueOnce({ isError: false, data: grant(3) })
      .mockResolvedValueOnce({ isError: false, data: grant(4) });
    render();

    await act(async () => defined(latest).onMediaError());
    await elapse(10 * 60_000);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(3).playback.videoUrl);
    await act(async () => defined(latest).onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);
    expect(latest?.error).toBeNull();
  });

  it("keeps playing through a refresh Clips doesn't answer, and asks again", async () => {
    playbackQuery().refetch.mockResolvedValue(down());
    render();

    await elapse(4 * 60_000 + 30_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
    expect(latest?.error).toBeNull();
    expect(latest?.grant?.playback.videoUrl).toBe(grant(1).playback.videoUrl);
    await elapse(5_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(2);
    await elapse(15_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);
    expect(latest?.error).toBeNull();
  });

  it("moves to the grant a later try brings back, then keeps its schedule", async () => {
    playbackQuery()
      .refetch.mockResolvedValue(down())
      .mockResolvedValueOnce(down("clips_unreachable"))
      .mockResolvedValueOnce(down("clip_rate_limited"))
      .mockResolvedValueOnce({ isError: false, data: grant(2) });
    render();

    await elapse(4 * 60_000 + 50_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();
    // grant(2) runs until T0 + 10 min, so the next ask is at T0 + 9:30.
    await elapse(4 * 60_000 + 39_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);
    await elapse(1_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(4);
  });

  it("shows the outage once the grant runs out unrefreshed, and stops asking", async () => {
    playbackQuery().refetch.mockResolvedValue(down("clips_unreachable"));
    render();

    await elapse(5 * 60_000 - 1);
    expect(latest?.error).toBeNull();
    await elapse(1);
    expect(latest?.error).toBe("clips_unreachable");
    await elapse(30 * 60_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);
  });

  it("shows the outage as soon as the source fails while Clips is out", async () => {
    playbackQuery().refetch.mockResolvedValue(down());
    render();
    await elapse(4 * 60_000 + 30_000);
    expect(latest?.error).toBeNull();

    await act(async () => defined(latest).onMediaError());
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(2);
    expect(latest?.error).toBe("refresh_failed");
  });

  it("stops at once when Clips or Content refuses a refresh", async () => {
    playbackQuery().refetch.mockResolvedValue(down("clip_embed_disabled"));
    render();
    await elapse(4 * 60_000 + 30_000);
    expect(latest?.error).toBe("clip_embed_disabled");
    await elapse(30 * 60_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while the tab is hidden, and once when it shows again", async () => {
    await playUntilClipsIsOut();
    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await elapse(10 * 60_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(3);

    playbackQuery().refetch.mockResolvedValueOnce({
      isError: false,
      data: grant(2),
    });
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(4);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();
  });

  it("asks again each time the window regains focus until Clips answers", async () => {
    await playUntilClipsIsOut();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(4);
    expect(latest?.error).toBe("refresh_failed");

    playbackQuery().refetch.mockResolvedValueOnce({
      isError: false,
      data: grant(2),
    });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(5);
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();
  });

  it("keeps the reason a refresh was refused", async () => {
    playbackQuery().refetch.mockResolvedValue({
      isError: true,
      data: undefined,
      error: Object.assign(new Error("gone"), { errorCode: "clip_expired" }),
    });
    render();

    await act(async () => defined(latest).onMediaError());
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
    await playUntilClipsIsOut();
    playbackQuery().refetch.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)),
    );

    act(() => defined(latest).retry());
    expect(latest).toMatchObject({ grant: null, loading: true, error: null });
    await elapse(5 * 60_000);
    expect(playbackQuery().refetch).toHaveBeenCalledTimes(4);

    await act(async () => answer({ isError: false, data: grant(2) }));
    expect(latest?.grant?.playback.videoUrl).toBe(grant(2).playback.videoUrl);
    expect(latest?.error).toBeNull();
  });

  it("keeps showing a retry that fails again", async () => {
    await playUntilClipsIsOut();
    playbackQuery().refetch.mockResolvedValueOnce(down("clips_unreachable"));

    await act(async () => defined(latest).retry());
    expect(latest?.error).toBe("clips_unreachable");
  });

  it("gives a source that failed after a refresh another chance on retry", async () => {
    playbackQuery()
      .refetch.mockResolvedValueOnce({ isError: false, data: grant(2) })
      .mockResolvedValueOnce({ isError: false, data: grant(3) });
    render();
    await act(async () => defined(latest).onMediaError());
    await act(async () => defined(latest).onMediaError());
    expect(latest?.error).toBe("unplayable");

    await act(async () => defined(latest).retry());
    expect(latest?.grant?.playback.videoUrl).toBe(grant(3).playback.videoUrl);
    expect(latest?.error).toBeNull();
  });

  it("never swaps a YouTube Clip's player on a timer", async () => {
    queries.byName["get-clip-playback"] = fakeQuery(
      grant(1, { videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" }),
    );
    render();
    await elapse(60 * 60_000);
    expect(playbackQuery().refetch).not.toHaveBeenCalled();
  });
});

const thread = {
  id: "c1",
  videoTimestampMs: 4_000,
  content: "Hi",
  authorName: "Ada",
  authorEmail: "ada@example.test",
  createdAt: "2026-10-23T12:00:00.000Z",
  replyCount: 0,
  replies: [],
};

describe("useClipComments", () => {
  it("asks for nothing and shows nothing while the Clip's comments are off", () => {
    render({ commentsOn: false });
    expect(latestComments).toEqual({ status: "off" });
    expect(queries.options["list-clip-comments"]?.enabled).toBe(false);
  });

  it("returns the comment threads", () => {
    queries.byName["list-clip-comments"] = fakeQuery({
      threads: [thread],
      truncated: false,
    });
    render();
    expect(latestComments).toEqual({
      status: "ready",
      threads: [thread],
      truncated: false,
    });
  });

  it("says when the list stops short of every thread", () => {
    queries.byName["list-clip-comments"] = fakeQuery({
      threads: [],
      truncated: true,
    });
    render();
    expect(latestComments).toEqual({
      status: "ready",
      threads: [],
      truncated: true,
    });
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
    expect(latestComments).toEqual({ status: "off" });
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
    expect(latestComments).toEqual({ status: "failed", threads: [] });

    queries.byName["list-clip-comments"] = fakeQuery();
    render();
    expect(latestComments).toEqual({ status: "loading" });
  });

  it("reports a failed refetch while keeping the threads it already had", () => {
    queries.byName["list-clip-comments"] = {
      ...fakeQuery({ threads: [thread], truncated: false }),
      isError: true,
      error: Object.assign(new Error("down"), {
        errorCode: "clips_unreachable",
      }),
    };
    render();
    expect(latestComments).toEqual({ status: "failed", threads: [thread] });
  });
});
