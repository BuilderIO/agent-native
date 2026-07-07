import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn());
const mockReadAppState = vi.hoisted(() => vi.fn());
const mockRecordingRow = vi.hoisted(() => ({
  ownerEmail: "owner@example.com",
  orgId: "org-test",
  videoUrl:
    "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-worker?apiKey=org-probe&token=asset-worker&alt=media",
}));
const mockRecordingRows = vi.hoisted(
  () => [] as Array<typeof mockRecordingRow>,
);
const mockUpdateWhere = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() =>
  vi.fn(() => ({ where: mockUpdateWhere })),
);

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
}));

vi.mock("@agent-native/core/server", () => ({
  captureRouteError: vi.fn(),
  getRequestOrgId: vi.fn(() => "org-test"),
  resolveSecret: vi.fn(async (key: string) => process.env[key] ?? null),
  resolveBuilderPrivateKey: vi.fn(async () => "bpk-test"),
  runWithRequestContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => [
          mockRecordingRows.shift() ?? mockRecordingRow,
        ]),
      };
      return builder;
    }),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  }),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      orgId: "recordings.orgId",
      videoUrl: "recordings.videoUrl",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("./recordings.js", () => ({
  ownerEmailMatches: vi.fn(),
}));

import {
  applyMediaWorkerCallback,
  builderCompressedMediaUrl,
  extractBuilderMediaTarget,
  queueBuilderMediaCompression,
  runBuilderMediaCompressionForRecording,
} from "./builder-media-compression";

describe("builder-media-compression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRecordingRows.length = 0;
    mockReadAppState.mockResolvedValue(null);
    delete process.env.CLIPS_BUILDER_BACKGROUND_COMPRESSION_MAX_BYTES;
    delete process.env.CLIPS_DISABLE_BUILDER_COMPRESSION;
    delete process.env.CLIPS_MEDIA_WORKER_ENABLED;
    delete process.env.CLIPS_MEDIA_WORKER_URL;
    delete process.env.CLIPS_MEDIA_WORKER_SECRET;
  });

  it("derives the deterministic compressed URL for Builder object URLs", () => {
    const target = extractBuilderMediaTarget(
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-ready?apiKey=org-probe&token=asset-ready&alt=media",
    );

    expect(target).toMatchObject({
      objectPath: "assets/org-probe/asset-ready",
      apiKey: "org-probe",
      assetId: "asset-ready",
    });
    expect(target?.compressedUrl).toBe(
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-ready%2Fcompressed?apiKey=org-probe&token=asset-ready&alt=media&optimized=true",
    );
  });

  it("derives compressed URLs for Builder file API URLs", () => {
    expect(
      builderCompressedMediaUrl(
        "https://cdn.builder.io/api/v1/file/assets%2Forg-probe%2Fasset-ready?apiKey=org-probe&token=asset-ready",
      ),
    ).toBe(
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-ready%2Fcompressed?apiKey=org-probe&token=asset-ready&alt=media&optimized=true",
    );
  });

  it("does not derive targets for optimized, already-compressed, or non-Builder media", () => {
    expect(
      extractBuilderMediaTarget(
        "https://cdn.builder.io/o/assets%2Forg%2Fasset?optimized=true",
      ),
    ).toBeNull();
    expect(
      extractBuilderMediaTarget(
        "https://cdn.builder.io/o/assets%2Forg%2Fasset%2Fcompressed?apiKey=org",
      ),
    ).toBeNull();
    expect(
      extractBuilderMediaTarget("https://example.com/assets/org/asset.mp4"),
    ).toBeNull();
  });

  it("records a terminal skip instead of retrying videos above the compression size gate", async () => {
    process.env.CLIPS_BUILDER_BACKGROUND_COMPRESSION_MAX_BYTES = "100";

    const result = await queueBuilderMediaCompression({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      videoUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-large?apiKey=org-probe&token=asset-large&alt=media",
      mimeType: "video/webm",
      providerId: "builder",
      sourceSizeBytes: 101,
    });

    expect(result).toEqual({
      queued: false,
      reason: "too-large",
      compressedUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-large%2Fcompressed?apiKey=org-probe&token=asset-large&alt=media&optimized=true",
    });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "recording-builder-compression-rec-1",
      expect.objectContaining({
        recordingId: "rec-1",
        status: "skipped-too-large",
        sourceSizeBytes: 101,
      }),
    );
  });

  it("does not queue Builder compression while the kill switch is enabled", async () => {
    process.env.CLIPS_DISABLE_BUILDER_COMPRESSION = "true";
    vi.stubGlobal("fetch", vi.fn());

    const result = await queueBuilderMediaCompression({
      recordingId: "rec-disabled",
      ownerEmail: "owner@example.com",
      videoUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-disabled?apiKey=org-probe&token=asset-disabled&alt=media",
      mimeType: "video/webm",
      providerId: "builder",
      sourceSizeBytes: 50,
    });

    expect(result).toEqual({ queued: false, reason: "disabled" });
    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not enqueue the media worker while the worker flag is off", async () => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.CLIPS_MEDIA_WORKER_URL = "https://worker.example.com/enqueue";
    process.env.CLIPS_MEDIA_WORKER_SECRET = "worker-secret-with-enough-length";

    await queueBuilderMediaCompression({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      videoUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-normal?apiKey=org-probe&token=asset-normal&alt=media",
      mimeType: "video/webm",
      providerId: "builder",
      sourceSizeBytes: 50,
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks compression failed after the Builder trigger retry limit", async () => {
    mockReadAppState.mockResolvedValue({
      recordingId: "rec-give-up",
      ownerEmail: "owner@example.com",
      sourceUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-give-up?apiKey=org-probe&token=asset-give-up&alt=media",
      compressedUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-give-up%2Fcompressed?apiKey=org-probe&token=asset-give-up&alt=media&optimized=true",
      objectPath: "assets/org-probe/asset-give-up",
      origin: "https://cdn.builder.io",
      apiKey: "org-probe",
      assetId: "asset-give-up",
      status: "retry",
      attempts: 4,
      queuedAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
      nextAttemptAt: "2026-07-06T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.includes("optimized=true")) {
          return new Response(null, { status: 404 });
        }
        return new Response("builder unavailable", { status: 503 });
      }),
    );

    const result = await runBuilderMediaCompressionForRecording({
      recordingId: "rec-give-up",
      ownerEmail: "owner@example.com",
      orgId: "org-test",
    });

    expect(result?.status).toBe("failed");
    expect(mockWriteAppState).toHaveBeenLastCalledWith(
      "recording-builder-compression-rec-give-up",
      expect.objectContaining({
        status: "failed",
        attempts: 5,
        detail: expect.stringContaining(
          "Builder media compression did not finish after 5 attempts",
        ),
      }),
    );
  });

  it("rejects media worker callbacks whose output URL is not the expected destination", async () => {
    mockReadAppState.mockResolvedValue({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      sourceUrl: mockRecordingRow.videoUrl,
      compressedUrl:
        "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-worker%2Fcompressed?apiKey=org-probe&token=asset-worker&alt=media&optimized=true",
      objectPath: "assets/org-probe/asset-worker",
      origin: "https://cdn.builder.io",
      apiKey: "org-probe",
      assetId: "asset-worker",
      status: "worker-queued",
      attempts: 1,
      queuedAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
      mediaWorker: {
        jobId: "rec-1:compress",
        outputUrl:
          "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-worker%2Fcompressed?apiKey=org-probe&token=asset-worker&alt=media&optimized=true",
        callbackUrl: "https://clips.example.com/api/media-worker/callback",
        attempts: 1,
      },
    });

    const result = await applyMediaWorkerCallback({
      jobId: "rec-1:compress",
      status: "done",
      outputUrl: "https://attacker.example.com/video.mp4",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Media worker outputUrl does not match the expected output",
      recordingId: "rec-1",
    });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("does not swap to compressed media when the recording URL changes during the atomic update", async () => {
    const compressedUrl =
      "https://cdn.builder.io/o/assets%2Forg-probe%2Fasset-worker%2Fcompressed?apiKey=org-probe&token=asset-worker&alt=media&optimized=true";
    mockRecordingRows.push(mockRecordingRow, mockRecordingRow, {
      ...mockRecordingRow,
      videoUrl: "https://example.com/replaced-video.mp4",
    });
    mockReadAppState.mockResolvedValue({
      recordingId: "rec-1",
      ownerEmail: "owner@example.com",
      sourceUrl: mockRecordingRow.videoUrl,
      compressedUrl,
      objectPath: "assets/org-probe/asset-worker",
      origin: "https://cdn.builder.io",
      apiKey: "org-probe",
      assetId: "asset-worker",
      status: "worker-queued",
      attempts: 1,
      queuedAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
      mediaWorker: {
        jobId: "rec-1:compress",
        outputUrl: compressedUrl,
        callbackUrl: "https://clips.example.com/api/media-worker/callback",
        attempts: 1,
      },
    });

    const result = await applyMediaWorkerCallback({
      jobId: "rec-1:compress",
      status: "done",
      outputUrl: compressedUrl,
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Recording media URL changed before worker completion",
      recordingId: "rec-1",
    });
    expect(mockUpdateWhere).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          column: "recordings.videoUrl",
          value: mockRecordingRow.videoUrl,
        }),
      ]),
    );
    expect(mockWriteAppState).toHaveBeenLastCalledWith(
      "recording-builder-compression-rec-1",
      expect.objectContaining({
        status: "skipped-source-changed",
      }),
    );
  });
});
