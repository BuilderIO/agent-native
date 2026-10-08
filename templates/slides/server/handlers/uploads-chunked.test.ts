import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  compareAndSetSession: vi.fn(),
  deleteBlob: vi.fn(),
  deleteOrphanedChunkCleanup: vi.fn(),
  deleteOrphanedVideoAssetCleanup: vi.fn(),
  deleteSession: vi.fn(),
  getHeader: vi.fn(),
  getQuery: vi.fn(),
  getRouterParam: vi.fn(),
  getSession: vi.fn(),
  isHosted: vi.fn(),
  listSessions: vi.fn(),
  listOrphanedChunkCleanups: vi.fn(),
  listOrphanedVideoAssetCleanups: vi.fn(),
  putBlob: vi.fn(),
  recordOrphanedChunkCleanup: vi.fn(),
  recordOrphanedVideoAssetCleanup: vi.fn(),
  readBody: vi.fn(),
  readBlob: vi.fn(),
  readRawBody: vi.fn(),
  saveFile: vi.fn(),
  setStatus: vi.fn(),
  resolveAuth: vi.fn(),
  findUploadedVideoAssetForSession: vi.fn(),
  uploadVideoAsset: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => mocks.getHeader(...args),
  getQuery: (...args: unknown[]) => mocks.getQuery(...args),
  getRouterParam: (...args: unknown[]) => mocks.getRouterParam(...args),
  readBody: (...args: unknown[]) => mocks.readBody(...args),
  readRawBody: (...args: unknown[]) => mocks.readRawBody(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setStatus(...args),
}));

vi.mock("@agent-native/core/private-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/private-blob")>()),
  deletePrivateBlob: (...args: unknown[]) => mocks.deleteBlob(...args),
  putPrivateBlob: (...args: unknown[]) => mocks.putBlob(...args),
  readPrivateBlob: (...args: unknown[]) => mocks.readBlob(...args),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: vi.fn((_context: unknown, callback: () => unknown) =>
    callback(),
  ),
}));

vi.mock("../lib/tenant-files.js", () => ({
  isHostedSlidesRuntime: () => mocks.isHosted(),
}));

vi.mock("../lib/chunked-upload-session.js", () => ({
  compareAndSetChunkedUploadSession: (...args: unknown[]) =>
    mocks.compareAndSetSession(...args),
  createChunkedUploadSession: (...args: unknown[]) =>
    mocks.createSession(...args),
  deleteOrphanedChunkCleanup: (...args: unknown[]) =>
    mocks.deleteOrphanedChunkCleanup(...args),
  deleteOrphanedVideoAssetCleanup: (...args: unknown[]) =>
    mocks.deleteOrphanedVideoAssetCleanup(...args),
  deleteChunkedUploadSession: (...args: unknown[]) =>
    mocks.deleteSession(...args),
  getChunkedUploadSession: (...args: unknown[]) => mocks.getSession(...args),
  listOrphanedChunkCleanups: (...args: unknown[]) =>
    mocks.listOrphanedChunkCleanups(...args),
  listOrphanedVideoAssetCleanups: (...args: unknown[]) =>
    mocks.listOrphanedVideoAssetCleanups(...args),
  listChunkedUploadSessions: (...args: unknown[]) =>
    mocks.listSessions(...args),
  recordOrphanedChunkCleanup: (...args: unknown[]) =>
    mocks.recordOrphanedChunkCleanup(...args),
  recordOrphanedVideoAssetCleanup: (...args: unknown[]) =>
    mocks.recordOrphanedVideoAssetCleanup(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) => mocks.resolveAuth(...args),
  withSlidesRequestContext: vi.fn(
    async (
      _event: unknown,
      callback: (context: { orgId: string }) => unknown,
      preResolvedContext?: { orgId?: string },
    ) => callback({ orgId: preResolvedContext?.orgId ?? "org-1" }),
  ),
}));

vi.mock("./uploads.js", () => ({
  maxReferenceFileBytes: vi.fn(() => 50 * 1024 * 1024),
  saveUploadedReferenceFile: (...args: unknown[]) => mocks.saveFile(...args),
}));

vi.mock("./assets.js", () => ({
  MAX_VIDEO_ASSET_FILE_SIZE: 50 * 1024 * 1024,
  findUploadedVideoAssetForSession: (...args: unknown[]) =>
    mocks.findUploadedVideoAssetForSession(...args),
  uploadVideoAsset: (...args: unknown[]) => mocks.uploadVideoAsset(...args),
}));

import {
  abortChunkedUpload,
  getChunkedUploadStatus,
  startChunkedUpload,
  uploadChunkedChunk,
} from "./uploads-chunked";

function session(overrides: Record<string, unknown> = {}) {
  return {
    uploadType: "reference",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    filename: "deck.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    declaredSize: 8,
    chunks: {},
    chunkSizes: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("chunked reference uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compareAndSetSession.mockResolvedValue(true);
    mocks.getRouterParam.mockReturnValue("session-1");
    mocks.isHosted.mockReturnValue(true);
    mocks.resolveAuth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com", orgId: "org-1" },
    });
    mocks.listSessions.mockResolvedValue([]);
    mocks.listOrphanedChunkCleanups.mockResolvedValue([]);
    mocks.listOrphanedVideoAssetCleanups.mockResolvedValue([]);
    mocks.recordOrphanedChunkCleanup.mockResolvedValue("orphan-1");
    mocks.recordOrphanedVideoAssetCleanup.mockResolvedValue("video-orphan-1");
    mocks.findUploadedVideoAssetForSession.mockResolvedValue(null);
    mocks.readBody.mockResolvedValue({
      filename: "deck.pptx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      declaredSize: 8,
    });
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "0" });
    mocks.getHeader.mockReturnValue("4");
    mocks.getSession.mockResolvedValue(session());
    mocks.readRawBody.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mocks.putBlob.mockResolvedValue({
      id: "blob-1",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    });
    mocks.readBlob.mockResolvedValue({
      data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    mocks.saveFile.mockResolvedValue({ path: "slides-upload:v1:final" });
    mocks.uploadVideoAsset.mockResolvedValue({
      url: "https://media.example.com/clip.mp4",
      filename: "clip.mp4",
      type: "video/mp4",
      size: 4,
    });
    mocks.deleteBlob.mockResolvedValue({
      deleted: true,
      provider: "public-upload:builder",
    });
  });

  it("keeps large local uploads on the multipart path", async () => {
    mocks.isHosted.mockReturnValue(false);

    await expect(startChunkedUpload({} as never)).resolves.toEqual({
      uploadMode: "multipart",
    });
    expect(mocks.listSessions).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("creates a new session when an expired-session cleanup fails", async () => {
    mocks.listSessions.mockResolvedValue([
      {
        sessionId: "expired",
        session: session({
          expiresAt: new Date(0).toISOString(),
          chunks: {
            "0": {
              id: "expired-blob",
              provider: "public-upload:builder",
              opaque: true,
              encrypted: true,
            },
          },
          chunkSizes: { "0": 4 },
        }),
      },
    ]);
    mocks.deleteBlob.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(startChunkedUpload({} as never)).resolves.toEqual({
      sessionId: expect.any(String),
      maxChunkBytes: 4 * 1024 * 1024,
    });
    expect(mocks.createSession).toHaveBeenCalled();
  });

  it("does not reap expired sessions from another organization", async () => {
    mocks.listSessions.mockResolvedValueOnce([
      {
        sessionId: "other-org-session",
        session: session({
          uploadType: "video",
          ownerEmail: "owner@example.com",
          orgId: "org-2",
          expiresAt: new Date(0).toISOString(),
        }),
      },
    ]);

    await expect(startChunkedUpload({} as never)).resolves.toMatchObject({
      sessionId: expect.any(String),
    });
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("keeps a finalizing session while its lease is active", async () => {
    const handle = {
      id: "finalizing-blob",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.listSessions.mockResolvedValue([
      {
        sessionId: "finalizing",
        session: session({
          uploadType: "video",
          filename: "clip.mp4",
          finalizingAt: new Date(Date.now() - 60_000).toISOString(),
          finalizationLeaseExpiresAt: new Date(
            Date.now() + 60_000,
          ).toISOString(),
          chunks: { "0": handle },
          chunkSizes: { "0": 4 },
        }),
      },
    ]);

    await expect(startChunkedUpload({} as never)).resolves.toEqual({
      sessionId: expect.any(String),
      maxChunkBytes: 4 * 1024 * 1024,
    });
    expect(mocks.compareAndSetSession).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("does not reclaim a finalization after a concurrent lease renewal", async () => {
    const handle = {
      id: "finalizing-blob",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.compareAndSetSession.mockResolvedValueOnce(false);
    mocks.listSessions.mockResolvedValue([
      {
        sessionId: "finalizing",
        session: session({
          uploadType: "video",
          filename: "clip.mp4",
          finalizingAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
          finalizationLeaseExpiresAt: new Date(
            Date.now() - 60_000,
          ).toISOString(),
          chunks: { "0": handle },
          chunkSizes: { "0": 4 },
        }),
      },
    ]);

    await expect(startChunkedUpload({} as never)).resolves.toEqual({
      sessionId: expect.any(String),
      maxChunkBytes: 4 * 1024 * 1024,
    });
    expect(mocks.compareAndSetSession).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("starts a bounded video upload session with the requesting owner", async () => {
    mocks.readBody.mockResolvedValue({
      filename: "clip.mp4",
      mimetype: "video/mp4",
      declaredSize: 5_566_718,
      uploadType: "video",
    });

    await expect(startChunkedUpload({} as never)).resolves.toEqual({
      sessionId: expect.any(String),
      maxChunkBytes: 4 * 1024 * 1024,
    });
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        uploadType: "video",
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        filename: "clip.mp4",
        declaredSize: 5_566_718,
      }),
    );
  });

  it("rejects a video upload above the shared 50 MB limit", async () => {
    mocks.readBody.mockResolvedValue({
      filename: "clip.mp4",
      mimetype: "video/mp4",
      declaredSize: 50 * 1024 * 1024 + 1,
      uploadType: "video",
    });

    await expect(startChunkedUpload({} as never)).resolves.toEqual({
      error: "Video too large (max 50 MB)",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects a missing Content-Length before buffering the body", async () => {
    mocks.getHeader.mockReturnValue(undefined);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Valid Content-Length header required",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 411);
    expect(mocks.readRawBody).not.toHaveBeenCalled();
  });

  it("rejects cumulative bytes above declaredSize before storing a chunk", async () => {
    mocks.getSession.mockResolvedValue(
      session({ declaredSize: 5, chunkSizes: { "0": 4 } }),
    );
    mocks.getQuery.mockReturnValue({ index: "1", isFinal: "0" });

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Uploaded bytes exceed the declared file size",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(mocks.readRawBody).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });

  it("returns object storage setup guidance when no provider is configured", async () => {
    mocks.putBlob.mockResolvedValue(null);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error:
        "No object storage is connected. Use Builder.io's managed storage (free) or configure your own S3-compatible storage keys in Settings → File uploads.",
      errorCode: "attachment_storage_unavailable",
      details: {
        attachmentStatus: "storageUnavailable",
        attachmentErrorCode: "attachment_storage_unavailable",
        reason: "not_configured",
        retryable: true,
        whoCanFix: "workspace_admin",
      },
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
  });

  it("deletes a replaced chunk after updating the session", async () => {
    const oldHandle = {
      id: "old",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.getSession.mockResolvedValue(
      session({ chunks: { "0": oldHandle }, chunkSizes: { "0": 4 } }),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.deleteBlob).toHaveBeenCalledWith(oldHandle);
    expect(mocks.putBlob).toHaveBeenCalled();
    expect(mocks.compareAndSetSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ chunks: { "0": oldHandle } }),
      expect.objectContaining({
        chunks: { "0": expect.objectContaining({ id: "blob-1" }) },
      }),
    );
    expect(mocks.compareAndSetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteBlob.mock.invocationCallOrder[0],
    );
  });

  it("records a replaced chunk when provider deletion fails", async () => {
    const oldHandle = {
      id: "old",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.getSession.mockResolvedValue(
      session({ chunks: { "0": oldHandle }, chunkSizes: { "0": 4 } }),
    );
    mocks.deleteBlob
      .mockResolvedValueOnce({ deleted: false })
      .mockResolvedValueOnce({ deleted: false });

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.recordOrphanedChunkCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        uploadSessionId: "session-1",
        chunkIndex: 0,
        handle: oldHandle,
      }),
    );
    expect(mocks.deleteOrphanedChunkCleanup).not.toHaveBeenCalled();
  });

  it("preserves the prior chunk when the replacement loses its session CAS", async () => {
    const oldHandle = {
      id: "old",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.compareAndSetSession.mockResolvedValueOnce(false);
    mocks.getSession.mockResolvedValueOnce(
      session({ chunks: { "0": oldHandle }, chunkSizes: { "0": 4 } }),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session changed while saving the chunk",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.deleteBlob).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "blob-1" }),
    );
    expect(mocks.deleteBlob).not.toHaveBeenCalledWith(oldHandle);
  });

  it("records a conflicted chunk before deleting it and keeps the record when deletion fails", async () => {
    mocks.compareAndSetSession.mockResolvedValueOnce(false);
    mocks.deleteBlob.mockResolvedValueOnce({
      deleted: false,
      provider: "public-upload:builder",
    });

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session changed while saving the chunk",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.recordOrphanedChunkCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        uploadSessionId: "session-1",
        chunkIndex: 0,
        handle: expect.objectContaining({ id: "blob-1" }),
      }),
    );
    expect(
      mocks.recordOrphanedChunkCleanup.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.deleteBlob.mock.invocationCallOrder[0]);
    expect(mocks.deleteOrphanedChunkCleanup).not.toHaveBeenCalled();
  });

  it("reports cleanup persistence failure when the conflicted blob also cannot be deleted", async () => {
    mocks.compareAndSetSession.mockResolvedValueOnce(false);
    mocks.recordOrphanedChunkCleanup.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    mocks.deleteBlob.mockResolvedValueOnce({
      deleted: false,
      provider: "public-upload:builder",
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
        error: "Conflicted upload chunk cleanup could not be recorded",
      });
      expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
    } finally {
      error.mockRestore();
    }
  });

  it("retries orphaned chunk cleanup only in the matching organization", async () => {
    mocks.listOrphanedChunkCleanups.mockResolvedValueOnce([
      {
        key: "orphan-1",
        cleanup: {
          version: 1,
          ownerEmail: "owner@example.com",
          orgId: "org-1",
          uploadSessionId: "session-old",
          chunkIndex: 0,
          handle: { id: "orphan-blob", provider: "private", opaque: true },
        },
      },
      {
        key: "orphan-other-org",
        cleanup: {
          version: 1,
          ownerEmail: "owner@example.com",
          orgId: "org-2",
          uploadSessionId: "session-old",
          chunkIndex: 0,
          handle: { id: "other-blob", provider: "private", opaque: true },
        },
      },
    ]);
    mocks.deleteBlob.mockResolvedValueOnce({
      deleted: false,
      provider: "private",
    });
    await startChunkedUpload({} as never);
    expect(mocks.deleteBlob).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "orphan-blob" }),
    );
    expect(mocks.deleteOrphanedChunkCleanup).not.toHaveBeenCalled();

    mocks.listOrphanedChunkCleanups.mockResolvedValueOnce([
      {
        key: "orphan-1",
        cleanup: {
          version: 1,
          ownerEmail: "owner@example.com",
          orgId: "org-1",
          uploadSessionId: "session-old",
          chunkIndex: 0,
          handle: { id: "orphan-blob", provider: "private", opaque: true },
        },
      },
    ]);
    mocks.deleteBlob.mockResolvedValueOnce({
      deleted: true,
      provider: "private",
    });
    await startChunkedUpload({} as never);
    expect(mocks.deleteOrphanedChunkCleanup).toHaveBeenCalledWith("orphan-1");
  });

  it("returns committed success when temporary cleanup fails", async () => {
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValue(session({ declaredSize: 4 }));
    mocks.deleteBlob.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual([
      { path: "slides-upload:v1:final" },
    ]);
    expect(mocks.saveFile).toHaveBeenCalled();
  });

  it("preserves the finalization error when chunk cleanup also fails", async () => {
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        mimeType: "video/mp4",
        declaredSize: 4,
      }),
    );
    mocks.uploadVideoAsset.mockRejectedValueOnce(
      Object.assign(new Error("storage unavailable"), { statusCode: 503 }),
    );
    mocks.deleteBlob.mockRejectedValueOnce(new Error("cleanup failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
        error: "storage unavailable",
      });
      expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
      expect(error).toHaveBeenCalledWith(
        "[slides-upload] failed finalization cleanup failed",
        expect.objectContaining({
          error: "storage unavailable",
          cleanupError: "cleanup failed",
        }),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("stores a completed video through the uploaded-assets path", async () => {
    const video = {
      url: "https://media.example.com/clip.mp4",
      filename: "clip.mp4",
      type: "video/mp4",
      size: 4,
    };
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        mimeType: "video/mp4",
        declaredSize: 4,
      }),
    );
    mocks.uploadVideoAsset.mockResolvedValue(video);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual(video);
    expect(mocks.uploadVideoAsset).toHaveBeenCalledWith({
      email: "owner@example.com",
      orgId: "org-1",
      originalName: "clip.mp4",
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      uploadSessionId: "session-1",
    });
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(mocks.compareAndSetSession).toHaveBeenCalledWith(
      "session-1",
      expect.any(Object),
      expect.objectContaining({ finalizingAt: expect.any(String) }),
    );
    expect(mocks.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("returns a committed video when its finalization lease expires during storage", async () => {
    const video = {
      url: "https://media.example.com/clip.mp4",
      filename: "clip.mp4",
      type: "video/mp4",
      size: 4,
    };
    let resolveUpload!: (value: typeof video) => void;
    let markUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      markUploadStarted = resolve;
    });
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        mimeType: "video/mp4",
        declaredSize: 4,
      }),
    );
    mocks.uploadVideoAsset.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
          markUploadStarted();
        }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.useFakeTimers();
    try {
      const upload = uploadChunkedChunk({} as never);
      await uploadStarted;
      mocks.compareAndSetSession.mockResolvedValueOnce(false);
      await vi.advanceTimersByTimeAsync(60_000);
      resolveUpload(video);

      await expect(upload).resolves.toEqual(video);
      expect(warn).toHaveBeenCalledWith(
        "[slides-upload] finalization lease ended during commit",
        expect.objectContaining({ sessionId: "session-1" }),
      );
      expect(mocks.deleteSession).toHaveBeenCalledWith("session-1");
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("rejects a video upload session owned by a different user", async () => {
    mocks.resolveAuth.mockResolvedValueOnce({
      ok: true,
      context: { email: "other@example.com", orgId: "org-1" },
    });
    mocks.getSession.mockResolvedValue(
      session({ uploadType: "video", filename: "clip.mp4" }),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session belongs to another user",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(mocks.readRawBody).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(mocks.findUploadedVideoAssetForSession).not.toHaveBeenCalled();
  });

  it("returns the completed video when a replay arrives after session cleanup", async () => {
    const video = { id: "asset-1", url: "https://media.example.com/clip.mp4" };
    mocks.getSession.mockResolvedValue(null);
    mocks.findUploadedVideoAssetForSession.mockResolvedValueOnce(video);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual(video);
    expect(mocks.findUploadedVideoAssetForSession).toHaveBeenCalledWith(
      "owner@example.com",
      "session-1",
      "org-1",
    );
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(mocks.uploadVideoAsset).not.toHaveBeenCalled();
  });

  it("returns the completed video while the session is still finalizing", async () => {
    const video = { id: "asset-1", url: "https://media.example.com/clip.mp4" };
    mocks.getSession.mockResolvedValue(
      session({ uploadType: "video", finalizingAt: new Date().toISOString() }),
    );
    mocks.findUploadedVideoAssetForSession.mockResolvedValueOnce(video);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual(video);
    expect(mocks.uploadVideoAsset).not.toHaveBeenCalled();
  });

  it("reports processing while a scoped video session is finalizing", async () => {
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        finalizingAt: new Date().toISOString(),
        finalizationLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    await expect(getChunkedUploadStatus({} as never)).resolves.toEqual({
      status: "processing",
      retryAfterMs: 1500,
    });
    expect(mocks.findUploadedVideoAssetForSession).toHaveBeenCalledWith(
      "owner@example.com",
      "session-1",
      "org-1",
    );
  });

  it("expires a finalization whose lease elapsed", async () => {
    mocks.getSession
      .mockResolvedValueOnce(
        session({
          uploadType: "video",
          finalizingAt: new Date(0).toISOString(),
          finalizationLeaseExpiresAt: new Date(0).toISOString(),
        }),
      )
      .mockResolvedValueOnce(null);

    await expect(getChunkedUploadStatus({} as never)).resolves.toEqual({
      status: "expired",
    });
    expect(mocks.compareAndSetSession).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("keeps polling when an expired finalization lease was renewed concurrently", async () => {
    mocks.getSession
      .mockResolvedValueOnce(
        session({
          uploadType: "video",
          finalizingAt: new Date(0).toISOString(),
          finalizationLeaseExpiresAt: new Date(0).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        session({
          uploadType: "video",
          finalizingAt: new Date().toISOString(),
          finalizationLeaseExpiresAt: new Date(
            Date.now() + 60_000,
          ).toISOString(),
        }),
      );
    mocks.compareAndSetSession.mockResolvedValueOnce(false);

    await expect(getChunkedUploadStatus({} as never)).resolves.toEqual({
      status: "processing",
      retryAfterMs: 1500,
    });
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("returns a completed video receipt from upload status", async () => {
    const video = { id: "asset-1", url: "https://media.example.com/clip.mp4" };
    mocks.getSession.mockResolvedValue(
      session({ uploadType: "video", finalizingAt: new Date().toISOString() }),
    );
    mocks.findUploadedVideoAssetForSession.mockResolvedValueOnce(video);

    await expect(getChunkedUploadStatus({} as never)).resolves.toEqual({
      status: "complete",
      video,
    });
  });

  it("reports a missing session as expired only after checking its receipt", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(getChunkedUploadStatus({} as never)).resolves.toEqual({
      status: "expired",
    });
    expect(mocks.findUploadedVideoAssetForSession).toHaveBeenCalledWith(
      "owner@example.com",
      "session-1",
      "org-1",
    );
  });

  it("does not reveal video status across organizations", async () => {
    mocks.resolveAuth.mockResolvedValueOnce({
      ok: true,
      context: { email: "owner@example.com", orgId: "org-2" },
    });
    mocks.getSession.mockResolvedValue(
      session({ uploadType: "video", filename: "clip.mp4" }),
    );

    await expect(getChunkedUploadStatus({} as never)).resolves.toEqual({
      error: "Upload session belongs to another user",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(mocks.findUploadedVideoAssetForSession).not.toHaveBeenCalled();
  });

  it("returns a conflict when expiry cleanup loses a race to finalization", async () => {
    mocks.getSession
      .mockResolvedValueOnce(session({ expiresAt: new Date(0).toISOString() }))
      .mockResolvedValueOnce(
        session({ finalizingAt: new Date().toISOString() }),
      );
    mocks.compareAndSetSession.mockResolvedValueOnce(false);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session is already finalizing",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
  });

  it("returns a conflict when size cleanup loses a race to finalization", async () => {
    mocks.getHeader.mockReturnValue("9");
    mocks.readRawBody.mockResolvedValue(new Uint8Array(9));
    mocks.getSession
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        session({ finalizingAt: new Date().toISOString() }),
      );
    mocks.compareAndSetSession.mockResolvedValueOnce(false);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session is already finalizing",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
  });

  it("rejects a final upload whose bytes do not equal declaredSize", async () => {
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload is incomplete or has an invalid size",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 400);
    expect(mocks.readBlob).not.toHaveBeenCalled();
  });

  it("deletes every chunk and its session when the owner aborts", async () => {
    const handles = [
      {
        id: "chunk-0",
        provider: "public-upload:builder",
        opaque: true,
        encrypted: true,
      },
      {
        id: "chunk-1",
        provider: "public-upload:builder",
        opaque: true,
        encrypted: true,
      },
    ];
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        chunks: { "0": handles[0], "1": handles[1] },
        chunkSizes: { "0": 4, "1": 4 },
      }),
    );

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.compareAndSetSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ uploadType: "video" }),
      expect.objectContaining({ cleanupState: "aborting" }),
    );
    expect(mocks.deleteBlob).toHaveBeenCalledTimes(2);
    for (const handle of handles) {
      expect(mocks.deleteBlob).toHaveBeenCalledWith(handle);
    }
    expect(mocks.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("does not abort an upload after finalization has claimed the session", async () => {
    const finalizingAt = new Date().toISOString();
    const handle = {
      id: "chunk-0",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        finalizingAt,
        chunks: { "0": handle },
        chunkSizes: { "0": 4 },
      }),
    );

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      error: "Upload session is already finalizing",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.compareAndSetSession).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("rejects an abort when its session CAS loses to finalization", async () => {
    const activeSession = session({
      uploadType: "video",
      filename: "clip.mp4",
    });
    mocks.getSession
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce({
        ...activeSession,
        finalizingAt: new Date().toISOString(),
      });
    mocks.compareAndSetSession.mockResolvedValueOnce(false);

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      error: "Upload session is already finalizing",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("treats an absent session as already cleaned", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("does not let another user abort the session", async () => {
    mocks.resolveAuth.mockResolvedValueOnce({
      ok: true,
      context: { email: "other@example.com", orgId: "org-1" },
    });
    mocks.getSession.mockResolvedValue(
      session({ uploadType: "video", filename: "clip.mp4" }),
    );

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      error: "Upload session belongs to another user",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(mocks.compareAndSetSession).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("does not let the same user in another org abort the session", async () => {
    mocks.resolveAuth.mockResolvedValueOnce({
      ok: true,
      context: { email: "owner@example.com", orgId: "org-2" },
    });
    mocks.getSession.mockResolvedValue(
      session({ uploadType: "video", filename: "clip.mp4" }),
    );

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      error: "Upload session belongs to another user",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(mocks.compareAndSetSession).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("retains the aborting session when blob deletion fails", async () => {
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        chunks: {
          "0": {
            id: "chunk-0",
            provider: "public-upload:builder",
            opaque: true,
            encrypted: true,
          },
        },
        chunkSizes: { "0": 4 },
      }),
    );
    mocks.deleteBlob.mockResolvedValue({
      deleted: false,
      provider: "public-upload:builder",
    });

    await expect(abortChunkedUpload({} as never)).resolves.toEqual({
      error: "Could not clean up upload session",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(mocks.compareAndSetSession).toHaveBeenCalledWith(
      "session-1",
      expect.any(Object),
      expect.objectContaining({ cleanupState: "aborting" }),
    );
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("does not recreate an aborted session when a chunk write loses its CAS", async () => {
    mocks.compareAndSetSession.mockResolvedValueOnce(false);
    mocks.getSession.mockResolvedValueOnce(
      session({ uploadType: "video", filename: "clip.mp4" }),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session changed while saving the chunk",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "blob-1" }),
    );
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("does not store a video asset when abort wins the final chunk CAS", async () => {
    mocks.compareAndSetSession.mockResolvedValueOnce(false);
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValue(
      session({
        uploadType: "video",
        filename: "clip.mp4",
        mimeType: "video/mp4",
        declaredSize: 4,
      }),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload session changed while saving the chunk",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 409);
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "blob-1" }),
    );
    expect(mocks.uploadVideoAsset).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it("continues finalization when a rejected CAS actually committed", async () => {
    const initial = session({
      uploadType: "video",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      declaredSize: 4,
    });
    const next = {
      ...initial,
      chunks: {
        "0": {
          id: "blob-1",
          provider: "public-upload:builder",
          opaque: true,
          encrypted: true,
        },
      },
      chunkSizes: { "0": 4 },
      finalizingAt: new Date().toISOString(),
      finalizationLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValueOnce(initial).mockResolvedValueOnce(next);
    mocks.compareAndSetSession.mockRejectedValueOnce(
      new Error("CAS response was lost"),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toMatchObject({
      url: "https://media.example.com/clip.mp4",
    });
    expect(mocks.uploadVideoAsset).toHaveBeenCalledTimes(1);
    expect(mocks.recordOrphanedChunkCleanup).not.toHaveBeenCalled();
    expect(mocks.uploadVideoAsset.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteBlob.mock.invocationCallOrder[0],
    );
  });

  it("records and removes a chunk when a rejected CAS lost to abort", async () => {
    const casError = new Error("CAS response was lost");
    mocks.getSession
      .mockResolvedValueOnce(
        session({ uploadType: "video", filename: "clip.mp4" }),
      )
      .mockResolvedValueOnce(
        session({
          uploadType: "video",
          filename: "clip.mp4",
          cleanupState: "aborting",
        }),
      );
    mocks.compareAndSetSession.mockRejectedValueOnce(casError);

    await expect(uploadChunkedChunk({} as never)).rejects.toBe(casError);
    expect(mocks.recordOrphanedChunkCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadSessionId: "session-1",
        chunkIndex: 0,
        orgId: "org-1",
      }),
    );
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "blob-1" }),
    );
  });

  it("retains an uncertain chunk receipt when CAS readback also fails", async () => {
    const casError = new Error("CAS failed");
    mocks.getSession
      .mockResolvedValueOnce(
        session({ uploadType: "video", filename: "clip.mp4" }),
      )
      .mockRejectedValueOnce(new Error("readback failed"));
    mocks.compareAndSetSession.mockRejectedValueOnce(casError);

    await expect(uploadChunkedChunk({} as never)).rejects.toBe(casError);
    expect(mocks.recordOrphanedChunkCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ uncertain: true }),
    );
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("keeps an uncertain cleanup receipt when its session still owns the blob", async () => {
    const handle = {
      id: "blob-1",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.listOrphanedChunkCleanups.mockResolvedValueOnce([
      {
        key: "orphan-1",
        cleanup: {
          version: 1,
          ownerEmail: "owner@example.com",
          orgId: "org-1",
          uploadSessionId: "session-1",
          chunkIndex: 0,
          handle,
          createdAt: new Date().toISOString(),
          uncertain: true,
        },
      },
    ]);
    mocks.getSession.mockResolvedValueOnce(
      session({
        chunks: { "0": handle },
        chunkSizes: { "0": 4 },
      }),
    );

    await startChunkedUpload({} as never);

    expect(mocks.deleteBlob).not.toHaveBeenCalled();
    expect(mocks.deleteOrphanedChunkCleanup).toHaveBeenCalledWith("orphan-1");
  });
});
