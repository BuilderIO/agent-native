import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppState = vi.hoisted(() => vi.fn());
const mockFetchS3ObjectByUrl = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(() => {
    throw new Error("tests must inject fetchers");
  }),
}));

vi.mock("../../server/lib/s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: (...args: unknown[]) => mockFetchS3ObjectByUrl(...args),
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

  it("fetches private hosted media through the recording-bound S3 provider", async () => {
    const seen: SeenInput[] = [];
    const app = unusedFetcher();
    const safe = unusedFetcher();
    mockFetchS3ObjectByUrl.mockResolvedValueOnce(
      new Response("hosted-private-bytes"),
    );

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-hosted-private",
      videoUrl: "https://private-storage.example.test/clips/rec-hosted-private",
      storageMode: "hosted",
      timeouts,
      extractor: recordingExtractor(seen),
      fetchers: { app, safe },
    });

    expect(mockFetchS3ObjectByUrl).toHaveBeenCalledWith(
      "https://private-storage.example.test/clips/rec-hosted-private",
      {
        storageMode: "hosted",
        recordingId: "rec-hosted-private",
        timeoutMs: timeouts.downloadMs,
      },
    );
    expect(seen[0].source.kind).toBe("file");
    expect(seen[0].fileBytes).toBe("hosted-private-bytes");
    expect(app).not.toHaveBeenCalled();
    expect(safe).not.toHaveBeenCalled();
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
    ).rejects.toMatchObject({
      code: "MEDIA_TOO_LARGE",
      message:
        "This video is too large to transcribe. It is 10 GB, over the 2 GB limit.",
    });
    expect(seen).toHaveLength(0);
  });

  it("refuses a download that won't fit in temp space before saving any of it", async () => {
    const seen: SeenInput[] = [];
    const freeSpace = vi.fn(async () => 512 * 1024 ** 2);
    let bodyRead = false;
    // A zero high-water mark pulls only when something reads the body.
    const body = new ReadableStream(
      {
        pull(controller) {
          bodyRead = true;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );

    await expect(
      prepareRecordingTranscriptionAudio({
        recordingId: "rec-big",
        videoUrl: "https://videos.example.test/big.mp4",
        timeouts,
        extractor: recordingExtractor(seen),
        fetchers: {
          app: unusedFetcher(),
          safe: fetcherReturning(
            () =>
              new Response(body, {
                headers: { "content-length": String(600 * 1024 ** 2) },
              }),
          ),
        },
        freeSpace,
      }),
    ).rejects.toMatchObject({
      code: "MEDIA_TOO_LARGE",
      message:
        "This video is too large to transcribe. It is 600 MB, and the server has room for 480 MB.",
    });
    expect(freeSpace).toHaveBeenCalledWith(
      expect.stringContaining("clips-transcription-source-"),
    );
    expect(bodyRead).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("checks hosted media against temp space too", async () => {
    mockFetchS3ObjectByUrl.mockResolvedValueOnce(
      new Response("x", {
        headers: { "content-length": String(500 * 1024 ** 2) },
      }),
    );

    await expect(
      prepareRecordingTranscriptionAudio({
        recordingId: "rec-hosted-big",
        videoUrl: "https://private-storage.example.test/clips/rec-hosted-big",
        storageMode: "hosted",
        timeouts,
        extractor: recordingExtractor([]),
        fetchers: { app: unusedFetcher(), safe: unusedFetcher() },
        freeSpace: async () => 500 * 1024 ** 2,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  });

  it("downloads a video that fits with room left for the audio", async () => {
    const seen: SeenInput[] = [];

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-fits",
      videoUrl: "https://videos.example.test/fits.mp4",
      timeouts,
      extractor: recordingExtractor(seen),
      fetchers: {
        app: unusedFetcher(),
        safe: fetcherReturning(
          () => new Response("fits", { headers: { "content-length": "4" } }),
        ),
      },
      freeSpace: async () => 33 * 1024 ** 2,
    });

    expect(seen[0].fileBytes).toBe("fits");
  });

  it("downloads anyway when the free space can't be read", async () => {
    const seen: SeenInput[] = [];

    await prepareRecordingTranscriptionAudio({
      recordingId: "rec-unknown-space",
      videoUrl: "https://videos.example.test/clip.mp4",
      timeouts,
      extractor: recordingExtractor(seen),
      fetchers: {
        app: unusedFetcher(),
        safe: fetcherReturning(
          () => new Response("clip", { headers: { "content-length": "4" } }),
        ),
      },
      freeSpace: async () => null,
    });

    expect(seen[0].fileBytes).toBe("clip");
  });

  it("reports running out of disk while saving as too large, not a raw ENOSPC", async () => {
    const diskFull = Object.assign(
      new Error("ENOSPC: no space left on device, write"),
      { code: "ENOSPC" },
    );
    const body = new ReadableStream({
      pull(controller) {
        controller.error(diskFull);
      },
    });

    await expect(
      prepareRecordingTranscriptionAudio({
        recordingId: "rec-disk-full",
        videoUrl: "https://videos.example.test/no-length.mp4",
        timeouts,
        extractor: recordingExtractor([]),
        fetchers: {
          app: unusedFetcher(),
          safe: fetcherReturning(() => new Response(body)),
        },
      }),
    ).rejects.toMatchObject({
      code: "MEDIA_TOO_LARGE",
      message:
        "This video is too large to transcribe. The server ran out of temporary space while saving it.",
    });
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
