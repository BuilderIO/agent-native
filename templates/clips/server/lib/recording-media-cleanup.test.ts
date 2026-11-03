import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDeleteS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockResolveBuilderRequestAuthorization = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockObjectSize = vi.hoisted(() => vi.fn());
const mockIsUrlInS3Storage = vi.hoisted(() => vi.fn());
const mockSubtractBytes = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("./s3-upload-provider.js", () => ({
  deleteS3ObjectByUrl: (...args: unknown[]) => mockDeleteS3ObjectByUrl(...args),
  isUrlInS3Storage: (...args: unknown[]) => mockIsUrlInS3Storage(...args),
  s3ObjectSizeBytesByUrl: (...args: unknown[]) => mockObjectSize(...args),
}));

vi.mock("./hosted-clip-allowance.js", () => ({
  subtractHostedClipRetainedBytes: (...args: unknown[]) =>
    mockSubtractBytes(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "builder:assets:write",
  resolveBuilderRequestAuthorization: () =>
    mockResolveBuilderRequestAuthorization(),
}));

import {
  deleteRecordingMediaObjects,
  deleteStoredMediaUrl,
  deleteSupersededHostedMedia,
  recordingMediaUrls,
} from "./recording-media-cleanup";

describe("recording-media-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    mockDeleteS3ObjectByUrl.mockResolvedValue(false);
    mockObjectSize.mockResolvedValue(null);
    mockIsUrlInS3Storage.mockResolvedValue(true);
    mockSubtractBytes.mockResolvedValue({ adjusted: true, quotaBytes: 0 });
    mockResolveBuilderRequestAuthorization.mockResolvedValue({
      authorization: "Bearer private-key",
      source: "legacy",
      legacyPublicKey: "public-key",
    });
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => ({
      ok: init.method !== "HEAD",
      status: init.method === "HEAD" ? 404 : 200,
      statusText: "OK",
      text: vi.fn(async () => ""),
    }));
  });

  it("deletes Builder CDN assets by their stored URL when S3 does not own the URL", async () => {
    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl:
        "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm?width=1200#preview",
      thumbnailUrl: null,
      animatedThumbnailUrl: null,
    });

    expect(result).toEqual({
      attempted: 1,
      deleted: 0,
      skipped: 0,
      external: 0,
      errors: [
        {
          url: "https://cdn.builder.io",
          error: "Storage provider did not confirm media deletion.",
        },
      ],
    });
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
      "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm?width=1200#preview",
    );
    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://cdn.builder.io/api/v1/assets/by-url",
    );
    expect(requestUrl.searchParams.get("url")).toBe(
      "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm?width=1200",
    );
    expect(requestUrl.searchParams.get("apiKey")).toBe("public-key");
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { Authorization: "Bearer private-key" },
    });
  });

  it("uses an OAuth token without legacy API key fields", async () => {
    mockResolveBuilderRequestAuthorization.mockResolvedValue({
      authorization: "Bearer oauth-token",
      source: "oauth",
    });

    await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl: "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm",
    });

    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("apiKey")).toBeNull();
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { Authorization: "Bearer oauth-token" },
    });
  });

  it("passes the registered video URL unchanged to Builder's exact-match delete", async () => {
    const videoUrl =
      "https://cdn.builder.io/o/assets%2Fexample-space%2Fexample-video?apiKey=example-space&token=example-download-token&alt=media&optimized=true";

    await deleteRecordingMediaObjects({ id: "rec_1", videoUrl });

    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("url")).toBe(videoUrl);
  });

  it.each([200, 404])(
    "reports Builder DELETE %i while the stored video still serves, without logging its token",
    async (status) => {
      const videoUrl =
        "https://cdn.builder.io/o/assets%2Fexample-space%2Fexample-video?token=example-download-token&alt=media";
      const warning = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      mockFetch
        .mockResolvedValueOnce({ ok: status === 200, status })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await deleteRecordingMediaObjects({
        id: "rec_1",
        videoUrl,
      });

      expect(result).toMatchObject({ deleted: 0, skipped: 0 });
      expect(result.errors).toHaveLength(1);
      expect(warning).toHaveBeenCalled();
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "example-download-token",
      );
      expect(JSON.stringify(result.errors)).not.toContain(
        "example-download-token",
      );
    },
  );

  it("does not confirm Builder storage deletion from DELETE 200 and CDN 403", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 403 });

    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl:
        "https://cdn.builder.io/api/v1/file/assets%2Fexample-video?token=example-download-token",
    });

    expect(result.deleted).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it("keeps Builder lookup 404 unconfirmed even after a negative serving check", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl:
        "https://cdn.builder.io/o/assets%2Fexample-video?token=example-download-token",
    });

    expect(result).toMatchObject({ deleted: 0, skipped: 0 });
    expect(result.errors).toHaveLength(1);
  });

  it("leaves an externally hosted URL alone when the configured S3 bucket does not own it", async () => {
    mockIsUrlInS3Storage.mockResolvedValue(false);
    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl: "https://cdn.loom.com/sessions/example.mp4",
    });
    expect(result).toMatchObject({ deleted: 0, external: 1, errors: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(["hosted", "own"] as const)(
    "reports a %s provider's unconfirmed delete rather than silently skipping it",
    async (storageMode) => {
      const result = await deleteRecordingMediaObjects({
        id: "rec_1",
        storageMode,
        videoUrl: "https://storage.example.com/clips/rec_1/clip.mp4",
      });

      expect(result).toMatchObject({ deleted: 0, skipped: 0 });
      expect(result.errors).toHaveLength(1);
    },
  );

  it("skips protected URLs before calling provider delete APIs", async () => {
    mockDeleteS3ObjectByUrl.mockResolvedValue(true);
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
      deleted: 1,
      skipped: 1,
      external: 0,
      errors: [],
    });
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledTimes(1);
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/media/clips/rec_1.mp4",
    );
  });

  it("reports an error when request-scoped Builder credentials are missing", async () => {
    mockResolveBuilderRequestAuthorization.mockResolvedValue(null);

    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      videoUrl: "https://cdn.builder.io/api/v1/image/assets%2Fvideo.webm",
      thumbnailUrl: null,
      animatedThumbnailUrl: null,
    });

    expect(result).toEqual({
      attempted: 1,
      deleted: 0,
      skipped: 0,
      external: 0,
      errors: [
        {
          url: "https://cdn.builder.io",
          error: "Storage provider did not confirm media deletion.",
        },
      ],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deletes hosted objects with the recording's pinned storage mode", async () => {
    mockDeleteS3ObjectByUrl.mockResolvedValue(true);

    await deleteRecordingMediaObjects({
      id: "rec_1",
      storageMode: "hosted",
      videoUrl: "https://storage.example.com/clips/rec_1/clip.mp4",
    });

    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
      "https://storage.example.com/clips/rec_1/clip.mp4",
      { storageMode: "hosted", recordingId: "rec_1" },
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("hosted retained-byte accounting", () => {
    const videoUrl = "https://storage.example.com/clips/rec_1/clip.mp4";
    const filmstripUrl = "https://storage.example.com/clips/rec_1/film.jpg";

    it("subtracts a deleted derivative's bytes from the ledger", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);
      mockObjectSize.mockResolvedValue(4096);

      await deleteRecordingMediaObjects({
        id: "rec_1",
        storageMode: "hosted",
        filmstripUrl,
      });

      expect(mockObjectSize).toHaveBeenCalledWith(filmstripUrl, {
        recordingId: "rec_1",
        storageMode: "hosted",
      });
      expect(mockSubtractBytes).toHaveBeenCalledWith({
        recordingId: "rec_1",
        deletedBytes: 4096,
      });
    });

    it("also subtracts for a single-object delete", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);
      mockObjectSize.mockResolvedValue(10);

      await deleteStoredMediaUrl(videoUrl, {
        storageMode: "hosted",
        recordingId: "rec_1",
      });

      expect(mockSubtractBytes).toHaveBeenCalledWith({
        recordingId: "rec_1",
        deletedBytes: 10,
      });
    });

    it("keeps the ledger when the provider did not confirm the delete", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(false);
      mockObjectSize.mockResolvedValue(4096);

      await deleteRecordingMediaObjects({
        id: "rec_1",
        storageMode: "hosted",
        filmstripUrl,
      });

      expect(mockSubtractBytes).not.toHaveBeenCalled();
    });

    it("keeps the ledger high rather than guessing when the size is unreadable", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);
      mockObjectSize.mockRejectedValue(new Error("network"));
      const errorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const result = await deleteRecordingMediaObjects({
        id: "rec_1",
        storageMode: "hosted",
        filmstripUrl,
      });

      expect(result.deleted).toBe(1);
      expect(mockSubtractBytes).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledOnce();
      expect(mockTrack).toHaveBeenCalledWith(
        "clips_hosted_byte_accounting_failed",
        expect.objectContaining({
          recording_id: "rec_1",
          reason: "size_unreadable",
        }),
      );
    });

    it("still reports the object deleted when the ledger write fails, and says so loudly", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);
      mockObjectSize.mockResolvedValue(10);
      mockSubtractBytes.mockRejectedValue(new Error("db down"));
      const errorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const result = await deleteRecordingMediaObjects({
        id: "rec_1",
        storageMode: "hosted",
        filmstripUrl,
      });

      expect(result.deleted).toBe(1);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("retained bytes not reduced"),
        expect.objectContaining({ recordingId: "rec_1" }),
      );
      expect(mockTrack).toHaveBeenCalledWith(
        "clips_hosted_byte_accounting_failed",
        expect.objectContaining({
          recording_id: "rec_1",
          reason: "ledger_update_failed",
        }),
      );
      expect(JSON.stringify(mockTrack.mock.calls)).not.toContain(filmstripUrl);
    });

    it("does not report accounting failure when the delete and ledger update succeed", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);
      mockObjectSize.mockResolvedValue(10);

      await deleteRecordingMediaObjects({
        id: "rec_1",
        storageMode: "hosted",
        filmstripUrl,
      });

      expect(mockTrack).not.toHaveBeenCalled();
    });
  });

  it("counts an external hosted-recording URL as external, not as a failed delete", async () => {
    mockIsUrlInS3Storage.mockImplementation(async (url: string) =>
      url.startsWith("https://storage.example.com/"),
    );
    mockDeleteS3ObjectByUrl.mockResolvedValue(true);

    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      storageMode: "hosted",
      videoUrl: "https://storage.example.com/clips/rec_1/clip.mp4",
      thumbnailUrl: "https://cdn.loom.com/sessions/thumbnails/abc.jpg",
    });

    expect(result).toMatchObject({
      deleted: 1,
      external: 1,
      skipped: 0,
      errors: [],
    });
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("leaves another recording's hosted object untouched", async () => {
    mockDeleteS3ObjectByUrl.mockResolvedValue(false);

    const result = await deleteRecordingMediaObjects({
      id: "rec_1",
      storageMode: "hosted",
      videoUrl: "https://storage.example.com/clips/victim/clip.mp4",
    });

    expect(result).toMatchObject({ deleted: 0, skipped: 0 });
    expect(result.errors).toHaveLength(1);
    expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
      "https://storage.example.com/clips/victim/clip.mp4",
      { storageMode: "hosted", recordingId: "rec_1" },
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("deleteStoredMediaUrl", () => {
    const url = "https://cdn.builder.io/api/v1/image/assets%2Fshot.png";
    const respond = (status: number) => ({
      ok: status < 300,
      status,
      statusText: String(status),
      text: vi.fn(async () => ""),
    });

    it("lets a legacy redaction retry finish when its exact stored URL no longer serves", async () => {
      mockFetch
        .mockResolvedValueOnce(respond(404))
        .mockResolvedValueOnce(respond(404));
      await expect(deleteStoredMediaUrl(url)).resolves.toBe(true);
    });

    it("does not equate access denial with absent redaction media", async () => {
      mockFetch
        .mockResolvedValueOnce(respond(404))
        .mockResolvedValueOnce(respond(403));
      await expect(deleteStoredMediaUrl(url)).resolves.toBe(false);
    });

    it("does not trust a 404 while the asset is still being served", async () => {
      // The same 404 is what a key without rights to the asset gets.
      mockFetch
        .mockResolvedValueOnce(respond(404))
        .mockResolvedValueOnce(respond(200));
      await expect(deleteStoredMediaUrl(url)).resolves.toBe(false);
    });

    it("passes hosted mode for a single hosted media deletion", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);

      await expect(
        deleteStoredMediaUrl(
          "https://storage.example.com/clips/rec_1/clip.mp4",
          { storageMode: "hosted", recordingId: "rec_1" },
        ),
      ).resolves.toBe(true);
      expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
        "https://storage.example.com/clips/rec_1/clip.mp4",
        { storageMode: "hosted", recordingId: "rec_1" },
      );
    });

    it("does not fall back to Builder for an unbound hosted URL", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(false);

      await expect(
        deleteStoredMediaUrl(
          "https://storage.example.com/clips/rec_1/clip.mp4",
          { storageMode: "hosted", recordingId: "other-recording" },
        ),
      ).resolves.toBe(false);

      expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(
        "https://storage.example.com/clips/rec_1/clip.mp4",
        { storageMode: "hosted", recordingId: "other-recording" },
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it("includes a screenshot's leftover files, so permanent delete removes them", () => {
    // Nothing else points at them; a row deleted without them leaves the
    // unredacted original in storage for good.
    expect(
      recordingMediaUrls({
        kind: "image",
        imageUrl: "https://store.example/burned.png",
        editsJson: JSON.stringify({
          unreclaimedUrls: ["https://store.example/copy.png"],
          burnInProgress: { staleUrls: ["https://store.example/original.png"] },
        }),
      }),
    ).toEqual([
      "https://store.example/burned.png",
      "https://store.example/original.png",
      "https://store.example/copy.png",
    ]);
  });

  it("refuses to list a screenshot's media when its edits cannot be read", () => {
    expect(() =>
      recordingMediaUrls({ kind: "image", editsJson: "{not json" }),
    ).toThrow(/could not be read/);
  });

  describe("deleteSupersededHostedMedia", () => {
    const previousUrl = "https://storage.example.com/clips/rec_1/old.jpg";
    const replacementUrl = "https://storage.example.com/clips/rec_1/new.jpg";

    it("deletes the replaced object and lowers the retained bytes", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(true);
      mockObjectSize.mockResolvedValue(10);

      await deleteSupersededHostedMedia(previousUrl, {
        recordingId: "rec_1",
        replacementUrl,
      });

      expect(mockDeleteS3ObjectByUrl).toHaveBeenCalledWith(previousUrl, {
        storageMode: "hosted",
        recordingId: "rec_1",
      });
      expect(mockSubtractBytes).toHaveBeenCalledWith({
        recordingId: "rec_1",
        deletedBytes: 10,
      });
    });

    it("leaves a missing, identical, or out-of-bucket URL alone", async () => {
      mockIsUrlInS3Storage.mockResolvedValue(false);
      await deleteSupersededHostedMedia(previousUrl, {
        recordingId: "rec_1",
        replacementUrl,
      });
      await deleteSupersededHostedMedia(null, {
        recordingId: "rec_1",
        replacementUrl,
      });
      await deleteSupersededHostedMedia(replacementUrl, {
        recordingId: "rec_1",
        replacementUrl,
      });

      expect(mockDeleteS3ObjectByUrl).not.toHaveBeenCalled();
    });

    it("reports, without throwing, a delete the provider did not confirm", async () => {
      mockDeleteS3ObjectByUrl.mockResolvedValue(false);
      const errorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await expect(
        deleteSupersededHostedMedia(previousUrl, {
          recordingId: "rec_1",
          replacementUrl,
        }),
      ).resolves.toBeUndefined();

      expect(errorLog).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith(
        "clips_hosted_byte_accounting_failed",
        expect.objectContaining({
          recording_id: "rec_1",
          reason: "superseded_delete_unconfirmed",
        }),
      );
    });
  });
});
