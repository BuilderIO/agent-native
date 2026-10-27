// @vitest-environment happy-dom

import type { ClipPlayback } from "@shared/clips-peer-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { ClipUpload } from "./clip-uploads";
import { ClipEmbed, ClipEmbedRead } from "./ClipEmbedBlock";

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

type FakeQuery = {
  data: unknown;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: Mock<
    () => Promise<{ isError: boolean; data?: unknown; error?: unknown }>
  >;
};

const queries = vi.hoisted(() => ({
  byName: {} as Record<string, FakeQuery>,
  options: {} as Record<string, Record<string, unknown> | undefined>,
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useRef } = await import("react");
  return {
    useActionQuery: (
      name: string,
      _params: unknown,
      options?: Record<string, unknown>,
    ) => {
      // A hook, as the real one is, so a render that calls it only some of
      // the time fails here too.
      useRef(name);
      queries.options[name] = options;
      return queries.byName[name];
    },
  };
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));

vi.mock("@agent-native/toolkit/app/review", () => ({
  InlineMarkdown: ({ content }: { content: string }) => <>{content}</>,
}));

const uploads = vi.hoisted(() => ({
  current: null as ClipUpload | null,
  clear: vi.fn(),
  fail: vi.fn(),
}));

vi.mock("./clip-uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clip-uploads")>()),
  useClipUpload: () => uploads.current,
  clearClipUpload: uploads.clear,
  failClipUpload: uploads.fail,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("sonner", () => ({ toast: toasts }));

function fakeQuery(data?: unknown, error?: unknown): FakeQuery {
  return {
    data,
    isError: Boolean(error),
    isSuccess: data !== undefined,
    error: error ?? null,
    refetch: vi.fn(async () => ({ isError: false, data })),
  };
}

function refusal(errorCode?: string) {
  return Object.assign(new Error("refused"), { errorCode });
}

function playback(overrides?: {
  recording?: Partial<ClipPlayback["recording"]>;
  playback?: Partial<ClipPlayback["playback"]>;
}): ClipPlayback {
  return {
    recording: {
      id: "rec_1",
      title: "Quarterly demo",
      kind: "video",
      status: "ready",
      durationMs: 12_000,
      width: 1280,
      height: 720,
      enableComments: true,
      embedProvider: null,
      ...overrides?.recording,
    },
    playback: {
      videoUrl: "https://clips.example.test/api/video/rec_1?cg=1",
      posterUrl: null,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      ...overrides?.playback,
    },
    viewer: { isOwner: false, canComment: true },
  };
}

const markers = [
  {
    id: "c1",
    videoTimestampMs: 4_000,
    content: "Look here",
    authorName: "Ada Example",
  },
  { id: "c2", videoTimestampMs: 9_500, content: "And here", authorName: null },
];

let root: Root | null = null;
let container: HTMLDivElement;

function render() {
  act(() =>
    defined(root).render(
      <TooltipProvider>
        <ClipEmbed documentId="doc_1" recordingId="rec_1" />
      </TooltipProvider>,
    ),
  );
}

beforeEach(() => {
  uploads.current = null;
  uploads.clear.mockReset();
  uploads.fail.mockReset();
  toasts.success.mockReset();
  queries.byName = {
    "get-clip-playback": fakeQuery(playback()),
    "list-clip-comments": fakeQuery({ markers, truncated: false }),
    "get-clips-links": fakeQuery({
      appUrl: "https://clips.example.test",
      linkOrigins: ["https://clips.example.test"],
    }),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ClipEmbed", () => {
  it("holds a 16:9 place while the Clip loads", () => {
    queries.byName["get-clip-playback"] = fakeQuery();
    render();
    const skeleton = container.querySelector<HTMLElement>(
      '[aria-label="clipEmbed.loading"]',
    );
    expect(skeleton?.style.aspectRatio).toBe("16 / 9");
    expect(container.querySelector("video")).toBeNull();
  });

  it("plays the Clip with its title, length and comment markers", () => {
    render();
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "https://clips.example.test/api/video/rec_1?cg=1",
    );
    expect(container.textContent).toContain("Quarterly demo");
    expect(container.textContent).toContain("0:12");
    expect(
      container.querySelectorAll("[data-player-comment-marker]"),
    ).toHaveLength(2);
    expect(
      container.querySelector(
        'a[href="https://clips.example.test/share/rec_1"]',
      ),
    ).not.toBeNull();
  });

  it("seeks to a comment when its marker is clicked", () => {
    render();
    const video = defined(container.querySelector("video"));
    const marker = defined(
      container.querySelector<HTMLButtonElement>(
        '[data-player-comment-marker][aria-label^="clipEmbed.commentsAtOne"]',
      ),
    );
    act(() => marker.click());
    expect(video.currentTime).toBe(4);
  });

  it("shows no markers and no error while the Clip's comments are off", () => {
    queries.byName["get-clip-playback"] = fakeQuery(
      playback({ recording: { enableComments: false } }),
    );
    render();
    expect(queries.options["list-clip-comments"]?.enabled).toBe(false);
    expect(container.querySelector("[data-player-comment-marker]")).toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.textContent).not.toContain("clipEmbed.commentsFailed");
  });

  it("says so when the comment list failed, and still plays", () => {
    queries.byName["list-clip-comments"] = fakeQuery(
      undefined,
      refusal("clips_unreachable"),
    );
    render();
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.textContent).toContain("clipEmbed.commentsFailed");
  });

  it("says it shows only the first threads when Clips held the rest back", () => {
    render();
    expect(container.textContent).not.toContain("clipEmbed.commentsTruncated");

    queries.byName["list-clip-comments"] = fakeQuery({
      markers,
      truncated: true,
    });
    render();
    expect(
      container.querySelectorAll("[data-player-comment-marker]"),
    ).toHaveLength(2);
    expect(container.textContent).toContain(
      'clipEmbed.commentsTruncated {"count":2}',
    );
  });

  it("keeps the markers it had when a later comment read fails, and says so", () => {
    queries.byName["list-clip-comments"] = fakeQuery(
      { markers },
      refusal("clips_unreachable"),
    );
    render();
    expect(
      container.querySelectorAll("[data-player-comment-marker]"),
    ).toHaveLength(2);
    expect(container.textContent).toContain("clipEmbed.commentsFailed");
  });

  it.each([
    ["clips_not_configured", "clipEmbed.notConfigured"],
    ["clip_not_found", "clipEmbed.notFound"],
    ["document_not_found", "clipEmbed.notFound"],
    ["clip_expired", "clipEmbed.expired"],
    ["clip_password_required", "clipEmbed.passwordRequired"],
    ["clip_redaction_pending", "clipEmbed.redactionPending"],
    ["clips_unreachable", "clipEmbed.unreachable"],
    ["clip_rate_limited", "clipEmbed.rateLimited"],
    ["clip_embed_disabled", "clipEmbed.disabled"],
    [undefined, "clipEmbed.failed"],
  ])("tells %s apart with its own message", (code, message) => {
    queries.byName["get-clip-playback"] = fakeQuery(undefined, refusal(code));
    render();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      message,
    );
    expect(container.querySelector("video")).toBeNull();
  });

  it("offers Clips for a password-protected Clip and a retry for an outage", () => {
    queries.byName["get-clip-playback"] = fakeQuery(
      undefined,
      refusal("clip_password_required"),
    );
    render();
    expect(
      container.querySelector(
        'a[href="https://clips.example.test/share/rec_1"]',
      )?.textContent,
    ).toBe("clipEmbed.openInClips");

    queries.byName["get-clip-playback"] = fakeQuery(
      undefined,
      refusal("clips_unreachable"),
    );
    render();
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "clipEmbed.retry",
    );
    act(() => defined(retry).click());
    expect(
      defined(queries.byName["get-clip-playback"]).refetch,
    ).toHaveBeenCalled();
  });

  it("asks for a fresh grant when the video fails", async () => {
    render();
    const video = defined(container.querySelector("video"));
    await act(async () => {
      video.dispatchEvent(new Event("error"));
    });
    expect(
      defined(queries.byName["get-clip-playback"]).refetch,
    ).toHaveBeenCalledTimes(1);
  });

  it("picks up where the reader was once Clips answers after an outage", async () => {
    const refetch = defined(queries.byName["get-clip-playback"]).refetch;
    render();
    const before = defined(container.querySelector("video"));
    await act(async () => {
      before.currentTime = 42;
      await before.play();
    });

    refetch.mockResolvedValueOnce({
      isError: true,
      data: undefined,
      error: refusal("clips_unreachable"),
    });
    await act(async () => {
      before.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).toContain("clipEmbed.unreachable");

    const fresh = playback({
      playback: { videoUrl: "https://clips.example.test/api/video/rec_1?cg=2" },
    });
    refetch.mockResolvedValueOnce({ isError: false, data: fresh });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    const after = defined(container.querySelector("video"));
    expect(after.src).toBe(fresh.playback.videoUrl);
    await act(async () => {
      after.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(after.currentTime).toBe(42);
    expect(after.paused).toBe(false);
  });

  it("plays a YouTube Clip in YouTube's player inside the frame", () => {
    queries.byName["get-clip-playback"] = fakeQuery(
      playback({
        recording: { embedProvider: "youtube" },
        playback: { videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" },
      }),
    );
    render();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
    expect(queries.options["list-clip-comments"]?.enabled).toBe(false);
  });

  it("drops one page's grant when the same Clip's block moves to another page", () => {
    const renderOn = (documentId: string) =>
      act(() =>
        defined(root).render(
          <TooltipProvider>
            <ClipEmbedRead
              data={{ recordingId: "rec_1", origin: "link" }}
              blockId="clip-1"
              ctx={{ documentId } as never}
            />
          </TooltipProvider>,
        ),
      );
    renderOn("doc_1");
    expect(container.querySelector("video")).not.toBeNull();

    queries.byName["get-clip-playback"] = fakeQuery(
      undefined,
      refusal("document_not_found"),
    );
    renderOn("doc_2");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "clipEmbed.notFound",
    );
  });

  it("declines a Clip another service plays, and links to Clips", () => {
    queries.byName["get-clip-playback"] = fakeQuery(
      playback({
        recording: { embedProvider: "loom" },
        playback: { videoUrl: "https://www.loom.com/embed/abc" },
      }),
    );
    render();
    expect(container.querySelector("video, iframe")).toBeNull();
    expect(container.textContent).toContain("clipEmbed.playsInClipsOnly");
    expect(container.textContent).toContain("clipEmbed.openInClips");
  });
});

describe("ClipEmbed while a Clip is uploaded", () => {
  const sending: ClipUpload = {
    recordingId: "rec_1",
    documentId: "doc_1",
    blockId: "clip-embed-abc12345",
    fileName: "demo.mp4",
    phase: "uploading",
    sentBytes: 42,
    totalBytes: 100,
  };

  function withStatus(status: "uploading" | "processing" | "ready" | "failed") {
    return fakeQuery(playback({ recording: { status } }));
  }

  function renderBlock(props: {
    origin: "upload" | "link";
    canEdit?: boolean;
  }) {
    act(() =>
      defined(root).render(
        <TooltipProvider>
          <ClipEmbedRead
            data={{ recordingId: "rec_1", origin: props.origin }}
            blockId="clip-embed-abc12345"
            ctx={{ documentId: "doc_1", canEdit: props.canEdit } as never}
          />
        </TooltipProvider>,
      ),
    );
  }

  async function waitMs(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("shows this tab's progress in the block", () => {
    uploads.current = sending;
    queries.byName["get-clip-playback"] = withStatus("uploading");
    render();
    const frame = container.querySelector('[data-clip-upload="uploading"]');
    expect(frame?.textContent).toContain(
      'clipEmbed.uploadingPercent {"percent":42}',
    );
    expect(frame?.textContent).toContain("demo.mp4");
    expect(container.querySelector("video")).toBeNull();
  });

  it("shows another page's upload of the Clip as any reader sees it", () => {
    uploads.current = { ...sending, documentId: "doc_2" };
    queries.byName["get-clip-playback"] = withStatus("uploading");
    render();
    expect(
      container.querySelector('[data-clip-upload="uploading"]'),
    ).toBeNull();
    expect(container.textContent).toContain("clipEmbed.uploading");
  });

  it.each([
    ["uploading", "clipEmbed.uploading"],
    ["processing", "clipEmbed.making"],
  ] as const)(
    "shows other readers a Clip that is still %s",
    (status, message) => {
      queries.byName["get-clip-playback"] = withStatus(status);
      render();
      const frame = container.querySelector('[data-clip-upload="making"]');
      expect(frame?.textContent).toBe(message);
      expect(container.querySelector("video")).toBeNull();
    },
  );

  it("says an uploaded Clip didn't finish, and lets only editors remove it", () => {
    queries.byName["get-clip-playback"] = withStatus("failed");
    renderBlock({ origin: "upload", canEdit: false });
    const unfinished = container.querySelector('[data-clip-upload="failed"]');
    expect(unfinished?.textContent).toContain("clipEmbed.uploadUnfinished");
    expect(unfinished?.querySelector("button")).toBeNull();

    renderBlock({ origin: "upload", canEdit: true });
    expect(
      container.querySelector('[data-clip-upload="failed"] button')
        ?.textContent,
    ).toBe("clipEmbed.remove");
  });

  it("removes the unfinished block from the page it's in", () => {
    const run = vi.fn();
    const deleteRange = vi.fn(() => ({ run }));
    const blocks = [
      { blockId: "clip-embed-other", pos: 1, nodeSize: 2 },
      { blockId: "clip-embed-abc12345", pos: 5, nodeSize: 3 },
    ];
    const page = Object.assign(document.createElement("div"), {
      editor: {
        isEditable: true,
        state: {
          doc: {
            descendants: (
              visit: (
                node: {
                  type: { name: string };
                  attrs: { blockId: string };
                  nodeSize: number;
                },
                pos: number,
              ) => boolean,
            ) => {
              for (const block of blocks) {
                const node = {
                  type: { name: "registryBlock" },
                  attrs: { blockId: block.blockId },
                  nodeSize: block.nodeSize,
                };
                if (visit(node, block.pos) === false) return;
              }
            },
          },
        },
        chain: () => ({ focus: () => ({ deleteRange }) }),
      },
    });
    page.className = "ProseMirror";
    container.append(page);
    act(() => root?.unmount());
    root = createRoot(page);
    queries.byName["get-clip-playback"] = withStatus("failed");
    renderBlock({ origin: "upload", canEdit: true });

    act(() =>
      defined(
        page.querySelector<HTMLButtonElement>(
          '[data-clip-upload="failed"] button',
        ),
      ).click(),
    );
    expect(deleteRange).toHaveBeenCalledWith({ from: 5, to: 8 });
    expect(run).toHaveBeenCalledOnce();
    expect(uploads.clear).toHaveBeenCalledWith("rec_1");
  });

  it("leaves a failed linked Clip to the usual messages", () => {
    queries.byName["get-clip-playback"] = withStatus("failed");
    renderBlock({ origin: "link", canEdit: true });
    expect(container.querySelector("[data-clip-upload]")).toBeNull();
  });

  it("calls a send that failed in this tab unfinished, unless Clips made the Clip", () => {
    uploads.current = { ...sending, phase: "failed" };
    queries.byName["get-clip-playback"] = withStatus("uploading");
    render();
    expect(
      container.querySelector('[data-clip-upload="failed"]'),
    ).not.toBeNull();

    act(() => defined(root).unmount());
    root = createRoot(container);
    queries.byName["get-clip-playback"] = withStatus("ready");
    render();
    expect(container.querySelector("[data-clip-upload]")).toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("tells the uploader once the Clip is made, with a way into Clips", async () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    uploads.current = { ...sending, phase: "making" };
    queries.byName["get-clip-playback"] = withStatus("processing");
    queries.byName["get-clip-playback"].refetch.mockResolvedValue({
      isError: false,
      data: playback(),
    });
    render();
    expect(container.textContent).toContain("clipEmbed.making");
    expect(toasts.success).not.toHaveBeenCalled();

    await waitMs(4_000);
    expect(uploads.clear).toHaveBeenCalledWith("rec_1");
    expect(toasts.success).toHaveBeenCalledOnce();
    const [message, options] = defined(toasts.success.mock.calls[0]);
    expect(message).toBe("clipEmbed.savedAsClip");
    expect(options.action.label).toBe("clipEmbed.openInClips");
    options.action.onClick();
    expect(open).toHaveBeenCalledWith(
      "https://clips.example.test/r/rec_1",
      "_blank",
      "noopener,noreferrer",
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  /** Answers every check with `status` until it's changed. */
  function answering(status: "uploading" | "processing" | "ready") {
    queries.byName["get-clip-playback"] = withStatus(status);
    const { refetch } = queries.byName["get-clip-playback"];
    const answer = { status };
    refetch.mockImplementation(async () => ({
      isError: false,
      data: playback({ recording: { status: answer.status } }),
    }));
    return { refetch, answer };
  }

  /** Moves the clock in steps, so each check's answer can set up the next. */
  async function waitInSteps(ms: number, step = 4_000) {
    for (let left = ms; left > 0; left -= step) {
      await waitMs(Math.min(step, left));
    }
  }

  function checkAgainButton() {
    return [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "clipEmbed.gateCheckAgain",
    );
  }

  it("asks about a Clip being made after 4 s, then twice as long each time, up to a minute", async () => {
    vi.useFakeTimers();
    const { refetch } = answering("processing");
    render();
    const start = Date.now();
    // Each check's time from the block appearing, in seconds.
    for (const [at, checks] of [
      [3.999, 0],
      [4, 1],
      [11.999, 1],
      [12, 2],
      [28, 3],
      [60, 4],
      [119.999, 4],
      [120, 5],
      [180, 6],
      [240, 7],
    ] as const) {
      await waitMs(at * 1_000 - Date.now() + start);
      expect(refetch, `at ${at} s`).toHaveBeenCalledTimes(checks);
    }
  });

  it("starts the gaps over when Clips reports a new status", async () => {
    vi.useFakeTimers();
    const { refetch, answer } = answering("uploading");
    render();
    await waitInSteps(28_000);
    expect(refetch).toHaveBeenCalledTimes(3);
    answer.status = "processing";
    await waitInSteps(32_000);
    expect(refetch).toHaveBeenCalledTimes(4);
    // Being made now: 4 s, then 8 s, from the new status.
    await waitMs(3_999);
    expect(refetch).toHaveBeenCalledTimes(4);
    await waitMs(1);
    expect(refetch).toHaveBeenCalledTimes(5);
    await waitMs(8_000);
    expect(refetch).toHaveBeenCalledTimes(6);
  });

  it("stops after 15 minutes with no new status, and offers Check again", async () => {
    vi.useFakeTimers();
    const { refetch } = answering("processing");
    render();
    await waitInSteps(15 * 60_000);
    // 4, 12, 28 and 60 s, then every minute through the fifteenth.
    expect(refetch).toHaveBeenCalledTimes(18);
    await waitInSteps(60 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(18);
    expect(
      container.querySelector('[data-clip-upload="making"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("clipEmbed.making");

    await act(async () => defined(checkAgainButton()).click());
    await waitMs(0);
    expect(refetch).toHaveBeenCalledTimes(19);
    // Still no new status: it keeps waiting for the reader.
    await waitInSteps(30 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(19);
    expect(checkAgainButton()).toBeDefined();
  });

  it("checks once when the reader comes back after the checks stopped, and goes on once the status moves", async () => {
    vi.useFakeTimers();
    const { refetch, answer } = answering("processing");
    render();
    await waitInSteps(15 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(18);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitMs(0);
    expect(refetch).toHaveBeenCalledTimes(19);
    await waitInSteps(10 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(19);

    answer.status = "ready";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitMs(0);
    expect(refetch).toHaveBeenCalledTimes(20);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("never asks while the tab is hidden, even when the reader comes back to a stopped block hidden", async () => {
    vi.useFakeTimers();
    const { refetch } = answering("processing");
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    render();
    await waitInSteps(20 * 60_000);
    expect(refetch).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // A tab hidden past the window gets one check when it shows, then waits.
    await waitMs(4_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    await waitInSteps(30 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(checkAgainButton()).toBeDefined();

    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitInSteps(60_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says so when a check on a Clip being made fails, and asks again on Retry", async () => {
    vi.useFakeTimers();
    queries.byName["get-clip-playback"] = withStatus("processing");
    const { refetch } = queries.byName["get-clip-playback"];
    refetch.mockResolvedValueOnce({
      isError: true,
      error: refusal("clips_unreachable"),
    });
    render();
    await waitMs(4_000);
    expect(container.querySelector("[data-clip-upload]")).toBeNull();
    expect(container.textContent).toContain("clipEmbed.unreachable");

    refetch.mockResolvedValueOnce({ isError: false, data: playback() });
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "clipEmbed.retry",
    );
    await act(async () => defined(retry).click());
    await waitMs(0);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("marks this tab's upload failed when Clips couldn't make the Clip", async () => {
    vi.useFakeTimers();
    uploads.current = { ...sending, phase: "making" };
    queries.byName["get-clip-playback"] = withStatus("processing");
    queries.byName["get-clip-playback"].refetch.mockResolvedValue({
      isError: false,
      data: playback({ recording: { status: "failed" } }),
    });
    renderBlock({ origin: "upload", canEdit: true });
    await waitMs(4_000);
    expect(uploads.fail).toHaveBeenCalledWith("rec_1");
    expect(
      container.querySelector('[data-clip-upload="failed"]'),
    ).not.toBeNull();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("doesn't ask while this tab is still sending the file", async () => {
    vi.useFakeTimers();
    uploads.current = sending;
    queries.byName["get-clip-playback"] = withStatus("uploading");
    render();
    await waitMs(20_000);
    expect(queries.byName["get-clip-playback"].refetch).not.toHaveBeenCalled();
  });
});
