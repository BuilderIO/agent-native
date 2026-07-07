import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDeleteS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockResolveBuilderCredentials = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("./s3-upload-provider.js", () => ({
  deleteS3ObjectByUrl: (...args: unknown[]) => mockDeleteS3ObjectByUrl(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveBuilderCredentials: () => mockResolveBuilderCredentials(),
}));

import { deleteRecordingMediaObjects } from "./recording-media-cleanup";

describe("recording-media-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockDeleteS3ObjectByUrl.mockResolvedValue(false);
    mockResolveBuilderCredentials.mockResolvedValue({
      privateKey: "private-key",
      publicKey: "public-key",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn(async () => ""),
    });
  });

  it("deletes Builder CDN assets by canonical URL when S3 does not own the URL", async () => {
    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl:
        "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm?width=1200#preview",
      thumbnailUrl: null,
      animatedThumbnailUrl: null,
    });

    expect(result).toEqual({
      attempted: 1,
      deleted: 1,
      skipped: 0,
      errors: [],
    });
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
      "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm?width=1200#preview",
    );
    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://cdn.builder.io/api/v1/assets/by-url",
    );
    expect(requestUrl.searchParams.get("url")).toBe(
      "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm",
    );
    expect(requestUrl.searchParams.get("apiKey")).toBe("public-key");
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { Authorization: "Bearer private-key" },
    });
  });

  it("skips protected URLs before calling provider delete APIs", async () => {
    const result = await deleteRecordingMediaObjects(
      {
        id: "rec_1",
        videoUrl: "https://cdn.example.com/media/clips/rec_1.mp4",
        thumbnailUrl: "https://cdn.example.com/media/clips/rec_1.jpg",
        animatedThumbnailUrl: null,
      },
      {
        protectedUrls: new Set([
          "https://cdn.example.com/media/clips/rec_1.jpg",
        ]),
      },
    );

    expect(result).toEqual({
      attempted: 2,
      deleted: 0,
      skipped: 2,
      errors: [],
    });
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledTimes(1);
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/media/clips/rec_1.mp4",
    );
  });

  it("skips Builder CDN URLs when request-scoped Builder credentials are missing", async () => {
    mockResolveBuilderCredentials.mockResolvedValue({
      privateKey: null,
      publicKey: null,
    });

    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl: "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm",
      thumbnailUrl: null,
      animatedThumbnailUrl: null,
    });

    expect(result).toEqual({
      attempted: 1,
      deleted: 0,
      skipped: 1,
      errors: [],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
