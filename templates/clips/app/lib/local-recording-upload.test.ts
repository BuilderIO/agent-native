import { UPLOAD_SLICE_BYTES } from "@shared/recording-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  uploadChunkRequest: vi.fn(),
  readRecoverableRecordingBackup: vi.fn(),
  updateRecordingBackupMeta: vi.fn(async () => ({})),
  deleteRecordingBackup: vi.fn(async () => {}),
  getRecordingBackupMeta: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => path,
  appBasePath: () => "",
}));
vi.mock("./upload-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./upload-request")>()),
  uploadChunkRequest: mocks.uploadChunkRequest,
}));
vi.mock("./thumbnail-capture", () => ({
  uploadVideoBlobThumbnail: vi.fn(async () => undefined),
}));
vi.mock("./recording-backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recording-backup")>();
  return {
    ...actual,
    readRecoverableRecordingBackup: mocks.readRecoverableRecordingBackup,
    updateRecordingBackupMeta: mocks.updateRecordingBackupMeta,
    deleteRecordingBackup: mocks.deleteRecordingBackup,
    getRecordingBackupMeta: mocks.getRecordingBackupMeta,
  };
});

import { createRecordingSchema } from "../../actions/lib/create-recording-schema";
import {
  classifyLocalUploadFailure,
  discardLocalRecording,
  LocalRecordingUploadError,
  uploadLocalRecording,
} from "./local-recording-upload";
import type { RecordingBackupMeta } from "./recording-backup";

const fetchMock = vi.fn();
const ME = { ownerEmail: "me@example.com" };

function copy(overrides: Partial<RecordingBackupMeta> = {}, bytes = 10) {
  return {
    meta: {
      recordingId: "local-1",
      mimeType: "video/webm",
      durationMs: 5_000,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasCamera: false,
      bytes,
      chunkCount: 1,
      savedAt: "2026-10-01T10:00:00.000Z",
      completedAt: "2026-10-01T10:00:05.000Z",
      state: "recorded-local",
      localOnly: true,
      ownerEmail: "me@example.com",
      title: "Demo",
      ...overrides,
    } satisfies RecordingBackupMeta,
    blob: new Blob([new Uint8Array(bytes)], { type: "video/webm" }),
    whole: true,
  };
}

function created(id: string) {
  return {
    id,
    uploadChunkUrl: `/api/uploads/${id}/chunk`,
    abortUrl: `/api/uploads/${id}/abort`,
    uploadMode: "streaming",
  };
}

/** A final-chunk response that proves the server holds `bytes` in full. */
function readyFor(bytes: number, durationMs = 5_000) {
  return json({
    ok: true,
    status: "ready",
    sourceSizeBytes: bytes,
    durationMs,
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function retryTransport(url: string): Response | null {
  if (url.includes("/resume?"))
    return json({
      resumable: true,
      attemptId: new URL(url, "https://clips.local").searchParams.get(
        "attemptId",
      ),
      uploadGenerationId: "claimed-generation",
    });
  if (url.endsWith("/reset-chunks"))
    return json({ uploadGenerationId: "reset-generation" });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  mocks.updateRecordingBackupMeta.mockResolvedValue({});
  fetchMock.mockImplementation(
    async (url: string) => retryTransport(url) ?? json({}),
  );
  mocks.callAction.mockImplementation(
    async (name: string, args: { id?: string }) =>
      name === "create-recording" ? created(args.id!) : {},
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("discardLocalRecording", () => {
  function trashedIds() {
    return mocks.callAction.mock.calls
      .filter((call) => call[0] === "trash-recording")
      .map((call) => (call[1] as { id: string }).id)
      .sort();
  }

  it("trashes the original take row along with retry rows", async () => {
    mocks.getRecordingBackupMeta.mockResolvedValue(
      copy({
        localOnly: false,
        serverRecordingId: "retry-2",
        staleServerRecordingIds: ["local-1", "retry-1"],
      }).meta,
    );

    await discardLocalRecording("local-1");

    expect(trashedIds()).toEqual(["local-1", "retry-1", "retry-2"]);
    expect(mocks.callAction).toHaveBeenCalledWith("trash-recording", {
      id: "local-1",
      skipIfReady: true,
    });
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });

  it("trashes nothing for a local-only copy that never uploaded", async () => {
    mocks.getRecordingBackupMeta.mockResolvedValue(copy().meta);

    await discardLocalRecording("local-1");

    expect(trashedIds()).toEqual([]);
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });

  it("still trashes the original take row when the copy is unreadable", async () => {
    mocks.getRecordingBackupMeta.mockRejectedValue(
      new DOMException("read failed", "UnknownError"),
    );

    await discardLocalRecording("local-1");

    expect(trashedIds()).toEqual(["local-1"]);
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });
});

describe("classifyLocalUploadFailure", () => {
  it("names the cause instead of falling back to unknown", () => {
    expect(classifyLocalUploadFailure({ networkError: true })).toBe("network");
    expect(
      classifyLocalUploadFailure({
        status: 503,
        message:
          "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.",
      }),
    ).toBe("storage_setup_required");
    expect(
      classifyLocalUploadFailure({
        status: 503,
        message:
          "Video storage could not start an upload: Builder.io signed-URL request failed (401): Unauthorized",
      }),
    ).toBe("server_unavailable");
    expect(
      classifyLocalUploadFailure({
        status: 400,
        errorCode: "builder_oauth_reauthorization_required",
      }),
    ).toBe("storage_setup_required");
    expect(
      classifyLocalUploadFailure({
        status: 503,
        errorCode: "builder_credentials_rejected",
      }),
    ).toBe("storage_setup_required");
    expect(
      classifyLocalUploadFailure({
        status: 503,
        errorCode: "hosted_storage_unavailable",
      }),
    ).toBe("hosted_storage_unavailable");
    expect(classifyLocalUploadFailure({ status: 401 })).toBe("session_expired");
    expect(
      classifyLocalUploadFailure({
        status: 401,
        message:
          "Builder.io signed-URL request failed (401): Authorization required",
      }),
    ).toBe("session_expired");
    expect(
      classifyLocalUploadFailure({
        status: 503,
        message:
          "Video storage could not start an upload: Builder.io signed-URL request failed (401): Unauthorized",
      }),
    ).toBe("server_unavailable");
    expect(classifyLocalUploadFailure({ status: 413 })).toBe(
      "recording_too_large",
    );
    expect(classifyLocalUploadFailure({ status: 502, isHtml: true })).toBe(
      "chunk_html_error",
    );
    expect(classifyLocalUploadFailure({ status: 503 })).toBe(
      "server_unavailable",
    );
    expect(classifyLocalUploadFailure({ status: 400 })).toBe("upload_failed");
  });
});

describe("uploadLocalRecording", () => {
  it("creates the clip under the local id, uploads every slice, and deletes the copy only once ready", async () => {
    const size = UPLOAD_SLICE_BYTES + 10;
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy({}, size));
    mocks.uploadChunkRequest
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(readyFor(size));

    const result = await uploadLocalRecording("local-1", ME);

    expect(result).toEqual({ recordingId: "local-1", status: "ready" });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "create-recording",
      expect.objectContaining({ id: "local-1", title: "Demo", hasAudio: true }),
      expect.anything(),
    );
    expect(mocks.updateRecordingBackupMeta).toHaveBeenCalledWith("local-1", {
      state: "uploading",
      serverRecordingId: "local-1",
      staleServerRecordingIds: [],
      lastError: null,
    });
    const urls = mocks.uploadChunkRequest.mock.calls.map(([arg]) => arg.url);
    expect(urls[0]).toContain("index=0");
    expect(urls[1]).toContain("isFinal=1");
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
    expect(
      mocks.deleteRecordingBackup.mock.invocationCallOrder[0],
    ).toBeGreaterThan(mocks.uploadChunkRequest.mock.invocationCallOrder[1]!);
  });

  it("retries a transient chunk failure with backoff instead of failing the upload", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ error: "busy" }, 503))
      .mockResolvedValueOnce(readyFor(10));

    const result = await uploadLocalRecording("local-1", {
      ...ME,
      retryDelaysMs: [0, 0, 0],
    });

    expect(result.status).toBe("ready");
    expect(mocks.uploadChunkRequest).toHaveBeenCalledTimes(3);
  });

  it("keeps the local copy and records a real failure code when storage refuses the upload", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest.mockResolvedValue(
      json(
        {
          error:
            "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.",
        },
        503,
      ),
    );

    const error = await uploadLocalRecording("local-1", {
      ...ME,
      retryDelaysMs: [0],
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LocalRecordingUploadError);
    expect((error as LocalRecordingUploadError).code).toBe(
      "storage_setup_required",
    );
    expect(mocks.uploadChunkRequest).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    expect(mocks.updateRecordingBackupMeta).toHaveBeenLastCalledWith(
      "local-1",
      expect.objectContaining({ state: "recorded-local" }),
    );
    const abort = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/abort"),
    );
    expect(JSON.parse(abort![1].body).failureCode).toBe(
      "storage_setup_required",
    );
  });

  it("keeps the local copy and exposes a retryable hosted storage outage", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest.mockResolvedValue(
      json(
        {
          error: "Clips hosted storage is temporarily unavailable.",
          errorCode: "hosted_storage_unavailable",
          retryable: true,
        },
        503,
      ),
    );

    const error = await uploadLocalRecording("local-1", ME).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      code: "hosted_storage_unavailable",
      status: 503,
      retryable: false,
    });
    expect(mocks.uploadChunkRequest).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    const abort = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/abort"),
    );
    expect(JSON.parse(abort![1].body).failureCode).toBe(
      "hosted_storage_unavailable",
    );
  });

  it("reports an exhausted storage-status 503 retry as an upload interruption", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({}, UPLOAD_SLICE_BYTES + 1),
    );
    mocks.uploadChunkRequest.mockImplementation(async () =>
      json(
        {
          errorCode: "video_storage_status_unavailable",
          retryable: true,
          storageSetupRequired: false,
        },
        503,
      ),
    );

    const error = await uploadLocalRecording("local-1", {
      ...ME,
      retryDelaysMs: [0],
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "server_unavailable", status: 503 });
    expect(mocks.uploadChunkRequest).toHaveBeenCalledTimes(2);
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    const abort = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/abort"),
    );
    expect(abort).toBeDefined();
    expect(JSON.parse(abort![1].body).failureCode).toBe("upload_interrupted");
  });

  it("surfaces an expired session after the chunk token refresh still gets 401", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest.mockResolvedValue(json({ error: "nope" }, 401));

    const error = await uploadLocalRecording("local-1", ME).catch(
      (e: unknown) => e,
    );

    expect((error as LocalRecordingUploadError).code).toBe("session_expired");
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("keeps the copy while the server is still processing it", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest.mockResolvedValue(
      json({ ok: true, status: "processing", verificationPending: true }, 202),
    );

    const result = await uploadLocalRecording("local-1", ME);

    expect(result.status).toBe("processing");
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    expect(mocks.updateRecordingBackupMeta).toHaveBeenLastCalledWith(
      "local-1",
      { state: "uploaded", uploadedAt: expect.any(String) },
    );
  });

  it("finishes without re-uploading when the previous attempt already reads ready", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ serverRecordingId: "srv-1", state: "uploading" }),
    );
    fetchMock.mockResolvedValueOnce(
      json({
        recording: {
          status: "ready",
          verificationPending: false,
          sourceSizeBytes: 10,
          durationMs: 5_000,
        },
      }),
    );

    const result = await uploadLocalRecording("local-1", ME);

    expect(result).toEqual({ recordingId: "srv-1", status: "ready" });
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });

  it("creates a fresh upload when the remembered server row no longer exists", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ serverRecordingId: "missing-row" }),
    );
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/status")
        ? json({ error: "not found" }, 404)
        : (retryTransport(String(url)) ?? readyFor(10)),
    );
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));

    const result = await uploadLocalRecording("local-1", ME);

    expect(result.status).toBe("ready");
    expect(mocks.callAction).toHaveBeenCalledWith(
      "create-recording",
      expect.objectContaining({ id: "missing-row" }),
      expect.anything(),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/resume?")),
    ).toBe(false);
  });

  // oracle-change: Recovery preserves the original Clip and its private context instead of creating a replacement row.
  it("replays an interrupted take into its original Clip with the claimed upload generation", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({
        recordingId: "srv-old",
        localOnly: false,
        completedAt: null,
        state: "recording",
        ownerOrgId: "org-a",
        serverRecordingId: "retry-1",
        staleServerRecordingIds: ["srv-old"],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      json({ recording: { status: "failed", verificationPending: false } }),
    );
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));
    const result = await uploadLocalRecording("srv-old", {
      ...ME,
      ownerOrgId: "org-a",
    });
    expect(result.recordingId).toBe("srv-old");
    expect(
      mocks.callAction.mock.calls.some(([name]) => name === "create-recording"),
    ).toBe(false);
    const claimUrl = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/resume?"),
    )?.[0] as string;
    const claim = new URL(claimUrl, "https://clips.local");
    expect(claim.pathname).toBe("/api/uploads/srv-old/resume");
    expect(claim.searchParams.get("expectedOwnerEmail")).toBe(ME.ownerEmail);
    expect(claim.searchParams.get("expectedOrgId")).toBe("org-a");
    const reset = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/reset-chunks"),
    );
    expect(JSON.parse(reset?.[1].body)).toMatchObject({
      attemptId: claim.searchParams.get("attemptId"),
      uploadGenerationId: "claimed-generation",
      useGenerationFence: true,
    });
    const upload = mocks.uploadChunkRequest.mock.calls[0]?.[0];
    const chunk = new URL(upload.url, "https://clips.local");
    expect(chunk.pathname).toBe("/api/uploads/srv-old/chunk");
    expect(chunk.searchParams.get("attemptId")).toBe(
      claim.searchParams.get("attemptId"),
    );
    expect(chunk.searchParams.get("uploadGenerationId")).toBe(
      "reset-generation",
    );
    expect(upload).toMatchObject({
      expectedOwnerEmail: ME.ownerEmail,
      expectedOrgId: "org-a",
    });
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "trash-recording",
      expect.objectContaining({ id: "srv-old" }),
    );
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("srv-old");
  });

  it("retains the copy without creating a substitute Clip when the original retry is denied", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ localOnly: false }),
    );
    fetchMock.mockResolvedValueOnce(
      json({ recording: { status: "failed", verificationPending: false } }),
    );
    fetchMock.mockResolvedValueOnce(
      json({ error: "A newer retry is active" }, 409),
    );
    await expect(uploadLocalRecording("local-1", ME)).rejects.toThrow(
      /resume 409/,
    );
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.uploadChunkRequest).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("refuses the same account's backup from a different workspace before any network work", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ ownerOrgId: "org-a" }),
    );
    await expect(
      uploadLocalRecording("local-1", { ...ME, ownerOrgId: "org-b" }),
    ).rejects.toMatchObject({ code: "owner_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.uploadChunkRequest).not.toHaveBeenCalled();
  });

  it("stops before replaying bytes when the account changes during the retry claim", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ localOnly: false }),
    );
    let current = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/status"))
        return json({
          recording: { status: "failed", verificationPending: false },
        });
      if (url.endsWith("/reset-chunks")) current = false;
      return retryTransport(url) ?? json({});
    });
    await expect(
      uploadLocalRecording("local-1", { ...ME, stillOwner: () => current }),
    ).rejects.toMatchObject({ code: "owner_mismatch" });
    expect(mocks.uploadChunkRequest).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("uploads from memory when the local copy could not be written", async () => {
    mocks.readRecoverableRecordingBackup.mockRejectedValue(
      new DOMException("Quota exceeded", "QuotaExceededError"),
    );
    mocks.updateRecordingBackupMeta.mockRejectedValue(new Error("missing"));
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(4, 2_000));

    const result = await uploadLocalRecording("local-9", {
      ...ME,
      memorySource: {
        blob: new Blob([new Uint8Array(4)], { type: "video/webm" }),
        mimeType: "video/webm",
        durationMs: 2_000,
        width: 640,
        height: 360,
        hasAudio: false,
        hasCamera: false,
        ownerEmail: "me@example.com",
      },
    });

    expect(result).toEqual({ recordingId: "local-9", status: "ready" });
  });

  describe("the recording's platform", () => {
    const createArgs = () =>
      mocks.callAction.mock.calls.find(
        ([name]) => name === "create-recording",
      )?.[1] as Record<string, unknown> | undefined;
    const createdPlatform = () => createArgs()?.recordingPlatform;
    // The action's own validation, not the mock: a value the server rejects
    // would leave the copy unable to upload.
    const expectAcceptedByCreateRecording = () =>
      expect(createRecordingSchema.safeParse(createArgs()).success).toBe(true);

    beforeEach(() => {
      mocks.uploadChunkRequest.mockResolvedValue(
        json({ ok: true, status: "ready" }),
      );
    });

    it("creates the clip with the platform the copy was recorded on", async () => {
      mocks.readRecoverableRecordingBackup.mockResolvedValue(
        copy({ recordingPlatform: "mobile" }),
      );

      await uploadLocalRecording("local-1", ME);

      expect(createdPlatform()).toBe("mobile");
      expect(createArgs()).toMatchObject({
        recordingSource: "local_copy_upload",
        recordingAttemptId: "local-1",
      });
      expectAcceptedByCreateRecording();
    });

    it("sends no platform for a copy saved before it was stored, so the server records unknown", async () => {
      mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());

      const result = await uploadLocalRecording("local-1", ME);

      expect(result.status).toBe("ready");
      expect(createdPlatform()).toBeUndefined();
      expectAcceptedByCreateRecording();
    });

    // oracle-change: Existing server rows resume in place; platform is preserved without issuing create-recording again.
    it("preserves the existing Clip on replay without changing its provenance", async () => {
      mocks.readRecoverableRecordingBackup.mockResolvedValue(
        copy({ serverRecordingId: "rec-earlier", recordingPlatform: "web" }),
      );
      fetchMock.mockResolvedValueOnce(
        json({ recording: { status: "failed", verificationPending: false } }),
      );
      mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));
      const result = await uploadLocalRecording("local-1", ME);
      expect(result.recordingId).toBe("rec-earlier");
      expect(createArgs()).toBeUndefined();
    });

    it("keeps the platform of a memory-only copy", async () => {
      mocks.readRecoverableRecordingBackup.mockRejectedValue(
        new DOMException("Quota exceeded", "QuotaExceededError"),
      );
      mocks.updateRecordingBackupMeta.mockRejectedValue(new Error("missing"));
      mocks.uploadChunkRequest.mockResolvedValue(readyFor(4, 2_000));

      await uploadLocalRecording("local-9", {
        ...ME,
        memorySource: {
          blob: new Blob([new Uint8Array(4)], { type: "video/webm" }),
          mimeType: "video/webm",
          durationMs: 2_000,
          width: 640,
          height: 360,
          hasAudio: false,
          hasCamera: false,
          ownerEmail: "me@example.com",
          recordingPlatform: "mobile",
        },
      });

      expect(createdPlatform()).toBe("mobile");
      expectAcceptedByCreateRecording();
    });
  });

  it("asks the server to confirm the copy's owner when it creates the clip", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest.mockResolvedValue(
      json({ ok: true, status: "ready" }),
    );

    await uploadLocalRecording("local-1", ME);

    expect(mocks.callAction).toHaveBeenCalledWith(
      "create-recording",
      expect.objectContaining({ expectedOwnerEmail: "me@example.com" }),
      expect.anything(),
    );
  });

  it("never uploads another account's copy into the signed-in account", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ ownerEmail: "other@example.com" }),
    );

    const error = await uploadLocalRecording("local-1", ME).catch(
      (e: unknown) => e,
    );

    expect((error as LocalRecordingUploadError).code).toBe("owner_mismatch");
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.uploadChunkRequest).not.toHaveBeenCalled();
    expect(mocks.updateRecordingBackupMeta).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("waits for an explicit claim before uploading an ownerless copy", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ ownerEmail: null }),
    );

    const error = await uploadLocalRecording("local-1", ME).catch(
      (e: unknown) => e,
    );

    expect((error as LocalRecordingUploadError).code).toBe("owner_unconfirmed");
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("keeps the copy when the live session turns out to be another account", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.callAction.mockRejectedValue(
      Object.assign(new Error("Action create-recording failed"), {
        status: 409,
        errorCode: "recording_owner_mismatch",
      }),
    );

    const error = await uploadLocalRecording("local-1", ME).catch(
      (e: unknown) => e,
    );

    expect((error as LocalRecordingUploadError).code).toBe("owner_mismatch");
    expect(mocks.uploadChunkRequest).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    expect(mocks.updateRecordingBackupMeta).toHaveBeenLastCalledWith(
      "local-1",
      expect.objectContaining({ state: "recorded-local" }),
    );
  });

  it("reports an unreadable copy apart from a missing one", async () => {
    mocks.readRecoverableRecordingBackup.mockRejectedValue(
      new DOMException("read failed", "UnknownError"),
    );

    const error = await uploadLocalRecording("local-1", ME).catch(
      (e: unknown) => e,
    );

    expect((error as LocalRecordingUploadError).code).toBe(
      "unreadable_local_copy",
    );
  });

  it("trashes the row a cancelled create may already have inserted", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.callAction.mockImplementation(async (name: string) => {
      if (name === "create-recording") {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      return {};
    });

    await expect(uploadLocalRecording("local-1", ME)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(mocks.callAction).toHaveBeenCalledWith("trash-recording", {
      id: "local-1",
      skipIfReady: true,
    });
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("keeps the copy when a short server assembly still reports ready", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy({}, 10));
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(6));

    const result = await uploadLocalRecording("local-1", ME);

    expect(result).toMatchObject({ status: "ready", kept: "mismatch" });
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
    expect(mocks.updateRecordingBackupMeta).toHaveBeenLastCalledWith(
      "local-1",
      { state: "uploaded", keptAfterUpload: "mismatch" },
    );
  });

  it("keeps the copy when the server reports ready without proof", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(copy());
    mocks.uploadChunkRequest.mockResolvedValue(
      json({ ok: true, status: "ready" }),
    );

    const result = await uploadLocalRecording("local-1", ME);

    expect(result.kept).toBe("unverified");
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("keeps a copy that was cut short after uploading what it has", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue({
      ...copy({ completedAt: null, state: "recording" }),
      whole: false,
    });
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));

    const result = await uploadLocalRecording("local-1", ME);

    expect(result.kept).toBe("partial");
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("does not upload again over a mismatched ready clip unless asked to", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ serverRecordingId: "srv-1", state: "uploaded" }),
    );
    fetchMock.mockImplementation(
      async (url: string) =>
        retryTransport(url) ??
        json({
          recording: {
            status: "ready",
            verificationPending: false,
            sourceSizeBytes: 3,
            durationMs: 5_000,
          },
        }),
    );
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));

    const kept = await uploadLocalRecording("local-1", ME);
    expect(kept).toMatchObject({ recordingId: "srv-1", kept: "mismatch" });
    expect(mocks.callAction).not.toHaveBeenCalled();

    const again = await uploadLocalRecording("local-1", {
      ...ME,
      reuploadMismatched: true,
    });
    // oracle-change: An explicit replay uses the original Clip and preserves its context association.
    expect(again.recordingId).toBe("srv-1");
    expect(again.kept).toBeUndefined();
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });

  it("offers to upload again once an earlier upload has processed too long", async () => {
    const processing = json({
      recording: { status: "processing", verificationPending: true },
    });
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({
        serverRecordingId: "srv-1",
        state: "uploaded",
        uploadedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      }),
    );
    fetchMock.mockImplementation(
      async (url: string) => retryTransport(url) ?? processing.clone(),
    );
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));

    const kept = await uploadLocalRecording("local-1", ME);
    expect(kept).toMatchObject({ recordingId: "srv-1", kept: "processing" });
    expect(mocks.callAction).not.toHaveBeenCalled();

    const again = await uploadLocalRecording("local-1", {
      ...ME,
      reuploadMismatched: true,
    });
    // oracle-change: An explicit replay uses the original Clip and preserves its context association.
    expect(again.recordingId).toBe("srv-1");
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });

  it("keeps waiting on an upload that only started processing recently", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({
        serverRecordingId: "srv-1",
        state: "uploaded",
        uploadedAt: new Date().toISOString(),
      }),
    );
    fetchMock.mockImplementation(
      async (url: string) =>
        retryTransport(url) ??
        json({
          recording: { status: "processing", verificationPending: true },
        }),
    );

    const result = await uploadLocalRecording("local-1", {
      ...ME,
      reuploadMismatched: true,
    });

    expect(result).toEqual({ recordingId: "srv-1", status: "processing" });
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("uploads again over a ready clip the server never proved complete", async () => {
    mocks.readRecoverableRecordingBackup.mockResolvedValue(
      copy({ serverRecordingId: "srv-1", state: "uploaded" }),
    );
    fetchMock.mockImplementation(
      async (url: string) =>
        retryTransport(url) ??
        json({ recording: { status: "ready", verificationPending: false } }),
    );
    mocks.uploadChunkRequest.mockResolvedValue(readyFor(10));

    const again = await uploadLocalRecording("local-1", {
      ...ME,
      reuploadMismatched: true,
    });

    // oracle-change: An explicit replay uses the original Clip and preserves its context association.
    expect(again.recordingId).toBe("srv-1");
    expect(again.kept).toBeUndefined();
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });
});
