import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  compareAndSetSession: vi.fn(),
  deleteBlob: vi.fn(),
  deleteSession: vi.fn(),
  getHeader: vi.fn(),
  getQuery: vi.fn(),
  getRouterParam: vi.fn(),
  getSession: vi.fn(),
  isHosted: vi.fn(),
  listSessions: vi.fn(),
  putBlob: vi.fn(),
  readBody: vi.fn(),
  readBlob: vi.fn(),
  readRawBody: vi.fn(),
  saveFile: vi.fn(),
  setStatus: vi.fn(),
  resolveAuth: vi.fn(),
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

vi.mock("../lib/tenant-files.js", () => ({
  isHostedSlidesRuntime: () => mocks.isHosted(),
}));

vi.mock("../lib/chunked-upload-session.js", () => ({
  compareAndSetChunkedUploadSession: (...args: unknown[]) =>
    mocks.compareAndSetSession(...args),
  createChunkedUploadSession: (...args: unknown[]) =>
    mocks.createSession(...args),
  deleteChunkedUploadSession: (...args: unknown[]) =>
    mocks.deleteSession(...args),
  getChunkedUploadSession: (...args: unknown[]) => mocks.getSession(...args),
  listChunkedUploadSessions: (...args: unknown[]) =>
    mocks.listSessions(...args),
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
  uploadVideoAsset: (...args: unknown[]) => mocks.uploadVideoAsset(...args),
}));

import {
  abortChunkedUpload,
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

  it("returns committed success when temporary cleanup fails", async () => {
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });
    mocks.getSession.mockResolvedValue(session({ declaredSize: 4 }));
    mocks.deleteBlob.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual([
      { path: "slides-upload:v1:final" },
    ]);
    expect(mocks.saveFile).toHaveBeenCalled();
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
});
