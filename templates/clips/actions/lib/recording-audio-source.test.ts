import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(() => {
    throw new Error("tests must inject fetchers");
  }),
}));

import {
  AudioOnlyExtractionError,
  type AudioExtractionInput,
} from "./audio-only-transcription";
import {
  prepareRecordingTranscriptionAudio,
  resolveRecordingMediaTarget,
} from "./recording-audio-source";

const timeouts = { downloadMs: 1000, extractionMs: 2000 };

type SeenInput = AudioExtractionInput & { fileBytes?: string };

function recordingExtractor(seen: SeenInput[], failures: Error[] = []) {
  return async (input: AudioExtractionInput) => {
    seen.push({
      ...input,
      ...(input.source.kind === "file"
        ? { fileBytes: readFileSync(input.source.path, "utf8") }
        : {}),
    });
    const failure = failures.shift();
    if (failure) throw failure;
    return {
      mimeType: "audio/mp4",
      maxVolumeDb: -12,
      chunks: [{ audioBytes: new Uint8Array([1]), startMs: 0, durationMs: 1 }],
    };
  };
}

function fetcherReturning(response: () => Response) {
  return vi.fn(async () => response());
}

const unusedFetcher = () =>
  vi.fn(async (): Promise<Response> => {
    throw new Error("fetcher should not be called");
  });

describe("resolveRecordingMediaTarget", () => {
  it("streams Builder CDN https URLs directly", () => {
    expect(
      resolveRecordingMediaTarget(
        "https://cdn.builder.io/o/assets%2Fa?alt=media",
      ),
    ).toEqual({
      kind: "stream",
      url: "https://cdn.builder.io/o/assets%2Fa?alt=media",
      origin: "builder-cdn",
    });
    expect(
      resolveRecordingMediaTarget("https://cdn-qa.builder.io/o/x").kind,
    ).toBe("stream");
  });

  it("downloads every other absolute URL through the SSRF guard", () => {
    for (const url of [
      "http://cdn.builder.io/o/x",
      "https://cdn.builder.io.example.test/o/x",
      "https://videos.example.test/clip.mp4",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(resolveRecordingMediaTarget(url)).toEqual({
        kind: "download",
        url,
      });
    }
  });

  it("streams app-relative URLs from the app's own origin", () => {
    vi.stubEnv("PUBLIC_URL", "https://clips.example.test");
    expect(resolveRecordingMediaTarget("/api/media/rec-1")).toEqual({
      kind: "stream",
      url: "https://clips.example.test/api/media/rec-1",
      origin: "app",
    });
    vi.unstubAllEnvs();
  });

  it("reads dev scratch uploads from application state", () => {
    expect(resolveRecordingMediaTarget("/api/video/rec-1").kind).toBe(
      "local-blob",
    );
    expect(resolveRecordingMediaTarget("/api/uploads/rec-1/blob").kind).toBe(
      "local-blob",
    );
  });
});

describe("prepareRecordingTranscriptionAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands Builder CDN URLs to ffmpeg without downloading them", async () => {
    const seen: SeenInput[] = [];
    const fetchers = { app: unusedFetcher(), safe: unusedFetcher() };

    const media = await prepareRecordingTranscriptionAudio({
      recordingId: "rec-cdn",
      videoUrl: "https://cdn.builder.io/o/video",
      timeouts,
      extractor: recordingExtractor(seen),
      fetchers,
    });

    expect(media.mimeType).toBe("audio/mp4");
    expect(seen).toEqual([
      {
        source: { kind: "url", url: "https://cdn.builder.io/o/video" },
        timeoutMs: 3000,
      },
    ]);
    expect(fetchers.safe).not.toHaveBeenCalled();
  });

  it("downloads external URLs to a temp file via the SSRF-safe fetcher", async () => {
    const seen: SeenInput[] = [];
    const safe = fetcherReturning(() => new Response("external-bytes"));

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-external",
      videoUrl: "https://videos.example.test/clip.mp4",
      timeouts,
      extractor: recordingExtractor(seen),
      fetchers: { app: unusedFetcher(), safe },
    });

    expect(safe).toHaveBeenCalledWith(
      "https://videos.example.test/clip.mp4",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].source.kind).toBe("file");
    expect(seen[0].fileBytes).toBe("external-bytes");
    expect(seen[0].timeoutMs).toBe(2000);
    const path = (seen[0].source as { path: string }).path;
    expect(existsSync(path)).toBe(false);
  });

  it("falls back to a downloaded copy when streaming fails to read the media", async () => {
    const seen: SeenInput[] = [];
    const safe = fetcherReturning(() => new Response("cdn-bytes"));

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-fallback",
      videoUrl: "https://cdn.builder.io/o/video",
      timeouts,
      extractor: recordingExtractor(seen, [
        new AudioOnlyExtractionError(
          "EXTRACTION_FAILED",
          "moov atom not found",
        ),
      ]),
      fetchers: { app: unusedFetcher(), safe },
    });

    expect(seen.map((input) => input.source.kind)).toEqual(["url", "file"]);
    expect(seen[1].fileBytes).toBe("cdn-bytes");
    expect(safe).toHaveBeenCalledTimes(1);
  });

  it("uses the plain app fetcher when an app-origin stream falls back", async () => {
    vi.stubEnv("PUBLIC_URL", "http://localhost:8080");
    const seen: SeenInput[] = [];
    const app = fetcherReturning(() => new Response("app-bytes"));

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-app",
      videoUrl: "/api/media/rec-app",
      timeouts,
      extractor: recordingExtractor(seen, [
        new AudioOnlyExtractionError("EXTRACTION_FAILED", "read error"),
      ]),
      fetchers: { app, safe: unusedFetcher() },
    });

    expect(app).toHaveBeenCalledWith(
      "http://localhost:8080/api/media/rec-app",
      expect.anything(),
    );
    expect(seen[1].fileBytes).toBe("app-bytes");
    vi.unstubAllEnvs();
  });

  it.each(["TIMEOUT", "NO_AUDIO_TRACK", "FFMPEG_UNAVAILABLE"] as const)(
    "does not retry a %s stream failure from a download",
    async (code) => {
      const safe = unusedFetcher();

      await expect(
        prepareRecordingTranscriptionAudio({
          recordingId: "rec-terminal",
          videoUrl: "https://cdn.builder.io/o/video",
          timeouts,
          extractor: recordingExtractor(
            [],
            [new AudioOnlyExtractionError(code, code)],
          ),
          fetchers: { app: unusedFetcher(), safe },
        }),
      ).rejects.toMatchObject({ code });
      expect(safe).not.toHaveBeenCalled();
    },
  );

  it("fails with the HTTP status when the download is rejected", async () => {
    await expect(
      prepareRecordingTranscriptionAudio({
        recordingId: "rec-404",
        videoUrl: "https://videos.example.test/missing.mp4",
        timeouts,
        extractor: recordingExtractor([]),
        fetchers: {
          app: unusedFetcher(),
          safe: fetcherReturning(
            () =>
              new Response("nope", { status: 404, statusText: "Not Found" }),
          ),
        },
      }),
    ).rejects.toThrow("Failed to fetch videoUrl: HTTP 404 Not Found");
  });

  it("refuses downloads that declare more than the upload limit", async () => {
    const seen: SeenInput[] = [];

    await expect(
      prepareRecordingTranscriptionAudio({
        recordingId: "rec-huge",
        videoUrl: "https://videos.example.test/huge.mp4",
        timeouts,
        extractor: recordingExtractor(seen),
        fetchers: {
          app: unusedFetcher(),
          safe: fetcherReturning(
            () =>
              new Response("x", {
                headers: { "content-length": String(10 * 1024 ** 3) },
              }),
          ),
        },
      }),
    ).rejects.toThrow(/too large to transcribe/);
    expect(seen).toHaveLength(0);
  });

  it("transcodes dev scratch uploads from their stashed bytes", async () => {
    mockReadAppState.mockResolvedValue({
      data: Buffer.from("stashed-bytes").toString("base64"),
    });
    const seen: SeenInput[] = [];

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-local",
      videoUrl: "/api/video/rec-local",
      timeouts,
      extractor: recordingExtractor(seen),
      fetchers: { app: unusedFetcher(), safe: unusedFetcher() },
    });

    expect(mockReadAppState).toHaveBeenCalledWith("recording-blob-rec-local");
    expect(seen[0].fileBytes).toBe("stashed-bytes");
  });
});
