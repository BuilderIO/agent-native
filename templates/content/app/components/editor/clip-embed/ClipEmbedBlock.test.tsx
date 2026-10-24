// @vitest-environment happy-dom

import type { ClipPlayback } from "@shared/clips-peer-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ClipEmbed } from "./ClipEmbedBlock";

type FakeQuery = {
  data: unknown;
  isError: boolean;
  isSuccess: boolean;
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

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));

vi.mock("@agent-native/toolkit/app/review", () => ({
  InlineMarkdown: ({ content }: { content: string }) => <>{content}</>,
}));

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
    root!.render(
      <TooltipProvider>
        <ClipEmbed documentId="doc_1" recordingId="rec_1" />
      </TooltipProvider>,
    ),
  );
}

beforeEach(() => {
  queries.byName = {
    "get-clip-playback": fakeQuery(playback()),
    "list-clip-comments": fakeQuery({ markers }),
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
    const video = container.querySelector("video")!;
    const marker = container.querySelector<HTMLButtonElement>(
      '[data-player-comment-marker][aria-label^="clipEmbed.commentsAtOne"]',
    )!;
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
    act(() => retry!.click());
    expect(queries.byName["get-clip-playback"]!.refetch).toHaveBeenCalled();
  });

  it("asks for a fresh grant when the video fails", async () => {
    render();
    const video = container.querySelector("video")!;
    await act(async () => {
      video.dispatchEvent(new Event("error"));
    });
    expect(queries.byName["get-clip-playback"]!.refetch).toHaveBeenCalledTimes(
      1,
    );
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
