import { afterEach, describe, expect, it, vi } from "vitest";

import {
  putRecordingBackupChunk,
  putRecordingBackupMeta,
} from "@/lib/recording-backup";
import { uploadChunkRequest } from "@/lib/upload-request";

import { RecorderEngine } from "./recorder-engine";

vi.mock("@/lib/recording-backup", () => ({
  deleteRecordingBackup: vi.fn(async () => {}),
  putRecordingBackupChunk: vi.fn(async () => {}),
  putRecordingBackupMeta: vi.fn(async () => {}),
}));

vi.mock("@/lib/upload-request", () => ({
  uploadChunkRequest: vi.fn(async () => Response.json({ ok: true })),
}));

const STREAM_CHUNK_BYTES = 15 * 256 * 1024;

class FakeVideoTrack {
  readonly kind = "video";
  readonly readyState = "live";

  getSettings(): MediaTrackSettings {
    return { width: 1280, height: 720 };
  }

  stop(): void {}
}

class FakeMediaStream {
  private readonly tracks: FakeVideoTrack[];

  constructor(tracks: FakeVideoTrack[] = []) {
    this.tracks = tracks;
  }

  addTrack(track: FakeVideoTrack): void {
    this.tracks.push(track);
  }

  getVideoTracks(): FakeVideoTrack[] {
    return this.tracks;
  }

  getAudioTracks(): MediaStreamTrack[] {
    return [];
  }

  getTracks(): FakeVideoTrack[] {
    return this.tracks;
  }
}

class FakeMediaRecorder extends EventTarget {
  static instance: FakeMediaRecorder | null = null;

  static isTypeSupported(): boolean {
    return true;
  }

  readonly mimeType = "video/webm";
  state: RecordingState = "inactive";

  constructor(..._args: unknown[]) {
    super();
    FakeMediaRecorder.instance = this;
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
  }

  pause(): void {
    this.state = "paused";
  }

  resume(): void {
    this.state = "recording";
  }

  emitChunk(blob: Blob): void {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", { value: blob });
    this.dispatchEvent(event);
  }
}

function makeEngine(): RecorderEngine {
  const engine = new RecorderEngine({
    recordingId: "rec-1",
    mode: "screen",
    uploadMode: "streaming",
    uploadUrl: "/api/uploads/rec-1/chunk",
    abortUrl: "/api/uploads/rec-1/abort",
    resetUrl: "/api/uploads/rec-1/reset-chunks",
  });
  (
    engine as unknown as {
      claimStreamingUploadResumePoint: () => Promise<null>;
    }
  ).claimStreamingUploadResumePoint = vi.fn(async () => null);
  return engine;
}

describe("RecorderEngine streaming connection recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    FakeMediaRecorder.instance = null;
  });

  it("starts streaming uploads without waiting for IndexedDB", async () => {
    let resolveWrite!: () => void;
    vi.mocked(putRecordingBackupChunk).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    const engine = makeEngine();
    const internals = engine as unknown as { displayStream: FakeMediaStream };
    internals.displayStream = new FakeMediaStream([new FakeVideoTrack()]);
    await engine.start();

    FakeMediaRecorder.instance!.emitChunk(
      new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], { type: "video/webm" }),
    );

    await vi.waitFor(() => {
      expect(uploadChunkRequest).toHaveBeenCalledOnce();
    });
    expect(putRecordingBackupChunk).toHaveBeenCalledOnce();

    resolveWrite();
  });

  it("waits for an online signal before starting a streaming upload", async () => {
    vi.useFakeTimers();
    const fakeWindow = Object.assign(new EventTarget(), {
      setTimeout,
      clearTimeout,
    });
    const fakeDocument = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    const navigatorState = { onLine: false };
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("navigator", navigatorState);
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi.fn(async () => ({ ok: true }));
    const internals = engine as unknown as {
      localChunks: Blob[];
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      recorder: { state: RecordingState } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
    };
    internals.localChunks = [source];
    internals.recorder = { state: "recording" };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;

    internals.queueChunk(source, 0, false);
    await internals.chunkQueue;

    expect(uploadChunk).not.toHaveBeenCalled();
    expect(resetUploadedChunks).not.toHaveBeenCalled();

    navigatorState.onLine = true;
    fakeWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(resetUploadedChunks).toHaveBeenCalledOnce();
    expect(uploadChunk).toHaveBeenCalledOnce();
  });

  it("resets and replays the durable source after a transient streaming failure without terminal capture failure", async () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    );
    vi.stubGlobal("document", new EventTarget());
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("provider session expired"), {
          status: 409,
          restartRequired: true,
        }),
      )
      .mockResolvedValue({ ok: true });
    const internals = engine as unknown as {
      localChunks: Blob[];
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      uploadFailure: Error | null;
      recorder: { state: RecordingState } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
      stopAfterUploadFailure: () => void;
    };
    const stopAfterUploadFailure = vi.fn();
    internals.localChunks = [source];
    internals.recorder = { state: "recording" };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;
    internals.stopAfterUploadFailure = stopAfterUploadFailure;

    internals.queueChunk(source, 0, false);
    await internals.chunkQueue;
    await vi.waitFor(() => {
      expect(resetUploadedChunks).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(uploadChunk).toHaveBeenCalledTimes(2);
    });
    expect(internals.localChunks).toEqual([source]);
    expect(internals.uploadFailure).toBeNull();
    expect(stopAfterUploadFailure).not.toHaveBeenCalled();
    expect(internals.state).toBe("recording");
  });

  it("keeps capture running through an offline reset failure and retries on online", async () => {
    vi.useFakeTimers();
    const fakeWindow = Object.assign(new EventTarget(), {
      setTimeout,
      clearTimeout,
    });
    const fakeDocument = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("offline"), { transport: true }),
      )
      .mockResolvedValue("streaming");
    const uploadChunk = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("connection lost"), { transport: true }),
      )
      .mockResolvedValue({ ok: true });
    const stopAfterUploadFailure = vi.fn();
    const internals = engine as unknown as {
      localChunks: Blob[];
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      recorder: { state: RecordingState } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
      stopAfterUploadFailure: () => void;
    };
    internals.localChunks = [source];
    internals.recorder = { state: "recording" };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;
    internals.stopAfterUploadFailure = stopAfterUploadFailure;

    internals.queueChunk(source, 0, false);
    await internals.chunkQueue;
    await vi.advanceTimersByTimeAsync(0);

    expect(stopAfterUploadFailure).not.toHaveBeenCalled();

    fakeWindow.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(resetUploadedChunks).toHaveBeenCalledTimes(2);
    expect(uploadChunk).toHaveBeenCalledTimes(2);
  });

  it("cleans up paused delivery listeners and retries on cancel", async () => {
    vi.useFakeTimers();
    const fakeWindow = Object.assign(new EventTarget(), {
      setTimeout,
      clearTimeout,
    });
    const fakeDocument = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    const removeWindowListener = vi.spyOn(fakeWindow, "removeEventListener");
    const removeDocumentListener = vi.spyOn(
      fakeDocument,
      "removeEventListener",
    );
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const internals = engine as unknown as {
      localChunks: Blob[];
      uploadChunk: (blob: Blob) => Promise<void>;
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      recorder: { state: RecordingState; stop: () => void } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
    };
    internals.localChunks = [source];
    internals.recorder = { state: "recording", stop: vi.fn() };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.uploadChunk = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("offline"), { transport: true }),
      );

    internals.queueChunk(source, 0, false);
    await internals.chunkQueue;
    await engine.cancel();

    expect(removeWindowListener).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    await vi.runAllTimersAsync();
    expect(internals.uploadChunk).toHaveBeenCalledOnce();
  });

  it("does not upload discarded streaming data when recovery settles after cancel", async () => {
    vi.useFakeTimers();
    const fakeWindow = Object.assign(new EventTarget(), {
      setTimeout,
      clearTimeout,
    });
    const fakeDocument = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    let resolveRecovery!: () => void;
    const recoverStreamingDelivery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const uploadChunk = vi.fn(async (_blob: Blob, _index: number) => ({
      ok: true,
    }));
    const internals = engine as unknown as {
      pendingStreamBlobs: Blob[];
      pendingStreamBytes: number;
      recorder: { state: RecordingState; stop: () => void } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
      streamingRecovery: { pause: () => void };
      recoverStreamingDelivery: typeof recoverStreamingDelivery;
      uploadChunk: typeof uploadChunk;
    };
    internals.pendingStreamBlobs = [source];
    internals.pendingStreamBytes = source.size;
    internals.recorder = { state: "recording", stop: vi.fn() };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.recoverStreamingDelivery = recoverStreamingDelivery;
    internals.uploadChunk = uploadChunk;

    internals.streamingRecovery.pause();
    await vi.advanceTimersByTimeAsync(0);
    expect(recoverStreamingDelivery).toHaveBeenCalledOnce();

    await engine.cancel();
    resolveRecovery();
    await Promise.resolve();
    await Promise.resolve();

    expect(internals.pendingStreamBlobs).toEqual([]);
    expect(internals.pendingStreamBytes).toBe(0);
    expect(uploadChunk).not.toHaveBeenCalled();
  });

  it("preserves the provider session reset signal on upload errors", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.mocked(uploadChunkRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ restartRequired: true }), { status: 409 }),
    );
    const engine = makeEngine();
    const internals = engine as unknown as {
      uploadChunk: (blob: Blob, index: number) => Promise<void>;
    };

    await expect(
      internals.uploadChunk(new Blob(["source"]), 0),
    ).rejects.toMatchObject({
      status: 409,
      restartRequired: true,
    });
  });

  it("classifies and sanitizes HTML chunk errors", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.mocked(uploadChunkRequest).mockResolvedValueOnce(
      new Response("<!doctype html><html>private proxy response</html>", {
        status: 400,
        headers: { "content-type": "text/html" },
      }),
    );
    const engine = makeEngine();
    const internals = engine as unknown as {
      uploadChunk: (blob: Blob, index: number) => Promise<unknown>;
    };
    const error = await internals
      .uploadChunk(new Blob(["source"]), 0)
      .catch((error: unknown) => error as Error & Record<string, unknown>);

    expect(error).toMatchObject({
      status: 400,
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
    });
    expect((error as Error).message).toContain("HTML error response (400)");
    expect((error as Error).message).not.toContain("private proxy response");
  });

  it("keeps permanent streaming failures terminal", async () => {
    const engine = makeEngine();
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("chunk too large"), { status: 413 }),
      );
    const onError = vi.fn();
    const stopAfterUploadFailure = vi.fn();
    const internals = engine as unknown as {
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      recorder: { state: RecordingState } | null;
      state: string;
      stopAfterUploadFailure: () => void;
      onError: (error: Error) => void;
    };
    internals.recorder = { state: "recording" };
    internals.state = "recording";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;
    internals.stopAfterUploadFailure = stopAfterUploadFailure;
    (engine as unknown as { opts: { onError: typeof onError } }).opts.onError =
      onError;

    internals.queueChunk(new Blob(["source"]), 0, false);
    await internals.chunkQueue;

    expect(resetUploadedChunks).not.toHaveBeenCalled();
    expect(stopAfterUploadFailure).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(internals.state).toBe("error");
  });

  it("keeps unexpected streaming errors terminal", async () => {
    const engine = makeEngine();
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi
      .fn()
      .mockRejectedValue(new Error("bad upload state"));
    const onError = vi.fn();
    const stopAfterUploadFailure = vi.fn();
    const internals = engine as unknown as {
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      recorder: { state: RecordingState } | null;
      state: string;
      stopAfterUploadFailure: () => void;
    };
    internals.recorder = { state: "recording" };
    internals.state = "recording";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;
    internals.stopAfterUploadFailure = stopAfterUploadFailure;
    (engine as unknown as { opts: { onError: typeof onError } }).opts.onError =
      onError;

    internals.queueChunk(new Blob(["source"]), 0, false);
    await internals.chunkQueue;

    expect(resetUploadedChunks).not.toHaveBeenCalled();
    expect(stopAfterUploadFailure).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(internals.state).toBe("error");
  });

  it("replays a chunk received during recovery exactly once", async () => {
    let resolveReset!: (uploadMode: "streaming") => void;
    let resolveFirstUpload!: (result: { ok: true }) => void;
    const engine = makeEngine();
    const first = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const second = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(
      () =>
        new Promise<"streaming">((resolve) => {
          resolveReset = resolve;
        }),
    );
    const uploadChunk = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveFirstUpload = resolve;
          }),
      )
      .mockResolvedValue({ ok: true });
    const internals = engine as unknown as {
      localChunks: Blob[];
      localChunkRevision: number;
      recoverStreamingDelivery: (restartRequired: boolean) => Promise<void>;
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
    };
    internals.localChunks = [first];
    internals.localChunkRevision = 1;
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;

    const replay = internals.recoverStreamingDelivery(false);
    await vi.waitFor(() => {
      expect(resetUploadedChunks).toHaveBeenCalledOnce();
    });

    resolveReset("streaming");
    await vi.waitFor(() => {
      expect(uploadChunk).toHaveBeenCalledOnce();
    });
    internals.localChunks.push(second);
    internals.localChunkRevision += 1;
    resolveFirstUpload({ ok: true });
    await replay;

    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect(
      uploadChunk.mock.calls.map(([blob, index]) => [blob.size, index]),
    ).toEqual([
      [STREAM_CHUNK_BYTES, 0],
      [STREAM_CHUNK_BYTES, 1],
    ]);
  });

  it("resumes from the server-confirmed offset without resetting", async () => {
    const engine = makeEngine();
    const first = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const second = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const claimStreamingUploadResumePoint = vi.fn(async () => ({
      bytesReceived: first.size,
      nextChunkIndex: 1,
    }));
    const uploadChunk = vi.fn(async (_blob: Blob, _index: number) => ({
      ok: true,
    }));
    const internals = engine as unknown as {
      localChunks: Blob[];
      localChunkRevision: number;
      recoverStreamingDelivery: (restartRequired: boolean) => Promise<void>;
      resetUploadedChunks: typeof resetUploadedChunks;
      claimStreamingUploadResumePoint: typeof claimStreamingUploadResumePoint;
      uploadChunk: typeof uploadChunk;
    };
    internals.localChunks = [first, second];
    internals.localChunkRevision = 1;
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.claimStreamingUploadResumePoint = claimStreamingUploadResumePoint;
    internals.uploadChunk = uploadChunk;

    await internals.recoverStreamingDelivery(false);

    expect(claimStreamingUploadResumePoint).toHaveBeenCalledOnce();
    expect(resetUploadedChunks).not.toHaveBeenCalled();
    expect(uploadChunk).toHaveBeenCalledOnce();
    expect(
      uploadChunk.mock.calls.map(([blob, index]) => [blob.size, index]),
    ).toEqual([[STREAM_CHUNK_BYTES, 1]]);
  });

  it("keeps the resume claim token when a reset is required", async () => {
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      location: { pathname: "/" },
    });
    const fetchMock = vi.fn(
      async (url: RequestInfo | URL, _options?: RequestInit) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/resume?")) {
          const attemptId = new URL(
            requestUrl,
            "http://localhost",
          ).searchParams.get("attemptId");
          return Response.json({
            resumable: true,
            uploadMode: "buffered",
            attemptId,
            uploadGenerationId: "generation-1",
            bytesReceived: 0,
            nextChunkIndex: 0,
          });
        }
        return Response.json({
          uploadMode: "streaming",
          uploadGenerationId: "generation-2",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
      uploadMode: "streaming",
      uploadUrl: "/api/uploads/rec-1/chunk",
      abortUrl: "/api/uploads/rec-1/abort",
      resetUrl: "/api/uploads/rec-1/reset-chunks",
    });
    const internals = engine as unknown as {
      claimStreamingUploadResumePoint: () => Promise<null>;
      resetUploadedChunks: () => Promise<void>;
      uploadAttemptId: string | null;
      uploadGenerationId: string | null;
    };

    await expect(
      internals.claimStreamingUploadResumePoint(),
    ).resolves.toBeNull();

    expect(internals.uploadAttemptId).toEqual(expect.any(String));
    expect(internals.uploadGenerationId).toBe("generation-1");

    await internals.resetUploadedChunks();

    const resetRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(resetRequest.body))).toMatchObject({
      attemptId: internals.uploadAttemptId,
      uploadGenerationId: "generation-1",
    });
  });

  it("keeps reset failures recoverable when they are temporary", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 })),
    );
    const engine = makeEngine();
    const internals = engine as unknown as {
      resetUploadedChunks: () => Promise<void>;
    };

    await expect(internals.resetUploadedChunks()).rejects.toMatchObject({
      transport: true,
    });
    await expect(internals.resetUploadedChunks()).rejects.toMatchObject({
      status: 503,
    });
  });

  it("does not let an older take reset a newer recording", async () => {
    let resolveClaim!: (resume: null) => void;
    const engine = makeEngine();
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const claimStreamingUploadResumePoint = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const internals = engine as unknown as {
      streamingRecoveryGeneration: number;
      recoverStreamingDelivery: (
        restartRequired: boolean,
        recoveryGeneration: number,
      ) => Promise<void>;
      claimStreamingUploadResumePoint: typeof claimStreamingUploadResumePoint;
      resetUploadedChunks: typeof resetUploadedChunks;
    };
    internals.streamingRecoveryGeneration = 1;
    internals.claimStreamingUploadResumePoint = claimStreamingUploadResumePoint;
    internals.resetUploadedChunks = resetUploadedChunks;

    const recovery = internals.recoverStreamingDelivery(false, 1);
    internals.streamingRecoveryGeneration = 2;
    resolveClaim(null);

    await expect(recovery).rejects.toMatchObject({ name: "AbortError" });
    expect(resetUploadedChunks).not.toHaveBeenCalled();
  });

  it("skips queued chunks from an aborted take when retrying", async () => {
    const engine = makeEngine();
    const first = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const second = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    let firstUploadStarted!: () => void;
    const uploadChunk = vi.fn(
      (_blob: Blob, _index: number, options?: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          firstUploadStarted = () => reject(options?.signal?.reason);
          options?.signal?.addEventListener("abort", firstUploadStarted, {
            once: true,
          });
        }),
    );
    const uploadBufferedChunks = vi.fn(async () => ({ status: "ready" }));
    const internals = engine as unknown as {
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      chunkQueue: Promise<void>;
      uploadChunk: typeof uploadChunk;
      uploadBufferedChunks: typeof uploadBufferedChunks;
      uploadAbort: AbortController | null;
      uploadMode: "streaming" | "buffered";
      localChunks: Blob[];
      lastFinalizeMeta: {
        durationMs: number;
        dimensions: { width: number; height: number };
        hasAudio: boolean;
        hasCamera: boolean;
      } | null;
    };
    internals.uploadAbort = new AbortController();
    internals.uploadMode = "streaming";
    internals.localChunks = [first, second];
    internals.lastFinalizeMeta = {
      durationMs: 1,
      dimensions: { width: 1280, height: 720 },
      hasAudio: false,
      hasCamera: false,
    };
    internals.uploadChunk = uploadChunk;
    internals.uploadBufferedChunks = uploadBufferedChunks;

    internals.queueChunk(first, 0, false);
    internals.queueChunk(second, 1, false);
    await vi.waitFor(() => {
      expect(uploadChunk).toHaveBeenCalledOnce();
    });

    const abortError = new Error("Recording stopped offline");
    abortError.name = "AbortError";
    internals.uploadAbort.abort(abortError);
    await engine.retryUpload();
    await internals.chunkQueue;

    expect(uploadBufferedChunks).toHaveBeenCalledOnce();
    expect(uploadChunk).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight recovery before retry starts", async () => {
    let resolveClaim!: (resume: null) => void;
    const engine = makeEngine();
    const claimStreamingUploadResumePoint = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveClaim = resolve;
        }),
    );
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadBufferedChunks = vi.fn(async () => ({ status: "ready" }));
    const internals = engine as unknown as {
      streamingRecoveryGeneration: number;
      recoverStreamingDelivery: (
        restartRequired: boolean,
        recoveryGeneration: number,
      ) => Promise<void>;
      claimStreamingUploadResumePoint: typeof claimStreamingUploadResumePoint;
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadBufferedChunks: typeof uploadBufferedChunks;
      uploadAbort: AbortController | null;
      localChunks: Blob[];
      lastFinalizeMeta: {
        durationMs: number;
        dimensions: { width: number; height: number };
        hasAudio: boolean;
        hasCamera: boolean;
      } | null;
    };
    const staleUploadAbort = new AbortController();
    internals.uploadAbort = staleUploadAbort;
    internals.localChunks = [new Blob(["recording"])];
    internals.lastFinalizeMeta = {
      durationMs: 1,
      dimensions: { width: 1280, height: 720 },
      hasAudio: false,
      hasCamera: false,
    };
    internals.claimStreamingUploadResumePoint = claimStreamingUploadResumePoint;
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadBufferedChunks = uploadBufferedChunks;

    const recovery = internals.recoverStreamingDelivery(
      false,
      internals.streamingRecoveryGeneration,
    );
    await vi.waitFor(() => {
      expect(claimStreamingUploadResumePoint).toHaveBeenCalledOnce();
    });

    await engine.retryUpload();
    resolveClaim(null);

    expect(staleUploadAbort.signal.aborted).toBe(true);
    await expect(recovery).rejects.toMatchObject({ name: "AbortError" });
    expect(uploadBufferedChunks).toHaveBeenCalledOnce();
    expect(resetUploadedChunks).not.toHaveBeenCalled();
  });

  it("drains recovery started by a queued chunk before finalizing", async () => {
    vi.useRealTimers();
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    );
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "visible" }),
    );
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("connection lost"), { transport: true }),
      )
      .mockResolvedValue({ status: "ready" });
    const internals = engine as unknown as {
      localChunks: Blob[];
      localChunkRevision: number;
      recorder: { state: RecordingState } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
      queueChunk: (blob: Blob, index: number, isFinal: boolean) => void;
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      uploadThumbnailForBlob: () => Promise<void>;
    };
    internals.localChunks = [source];
    internals.localChunkRevision = 1;
    internals.recorder = { state: "inactive" };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;
    internals.uploadThumbnailForBlob = vi.fn(async () => {});
    internals.queueChunk(source, 0, false);

    await engine.stop();

    expect(resetUploadedChunks).toHaveBeenCalledOnce();
    expect(uploadChunk).toHaveBeenCalledTimes(3);
    expect(
      uploadChunk.mock.calls.map(([blob, index]) => [blob.size, index]),
    ).toEqual([
      [STREAM_CHUNK_BYTES, 0],
      [STREAM_CHUNK_BYTES, 0],
      [0, 1],
    ]);
  });

  it("drains paused delivery before sending the final streaming chunk", async () => {
    vi.useRealTimers();
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    );
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "visible" }),
    );
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi.fn(async (_blob: Blob, _index: number) => ({
      status: "ready",
    }));
    const internals = engine as unknown as {
      localChunks: Blob[];
      localChunkRevision: number;
      recorder: { state: RecordingState } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
      streamingRecovery: { pause: () => void };
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
      uploadThumbnailForBlob: () => Promise<void>;
    };
    internals.localChunks = [source];
    internals.localChunkRevision = 1;
    internals.recorder = { state: "inactive" };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.streamingRecovery.pause();
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;
    internals.uploadThumbnailForBlob = vi.fn(async () => {});

    await engine.stop();

    expect(resetUploadedChunks).toHaveBeenCalledOnce();
    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect(
      uploadChunk.mock.calls.map(([blob, index]) => [blob.size, index]),
    ).toEqual([
      [STREAM_CHUNK_BYTES, 0],
      [0, 1],
    ]);
  });

  it("fails instead of waiting when streaming is stopped offline", async () => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
    );
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { visibilityState: "visible" }),
    );
    vi.stubGlobal("navigator", { onLine: false });
    const engine = makeEngine();
    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    const resetUploadedChunks = vi.fn(async () => "streaming" as const);
    const uploadChunk = vi.fn(async (_blob: Blob, _index: number) => ({
      status: "ready",
    }));
    const internals = engine as unknown as {
      localChunks: Blob[];
      recorder: { state: RecordingState } | null;
      state: string;
      uploadMode: "streaming" | "buffered";
      resetUploadedChunks: typeof resetUploadedChunks;
      uploadChunk: typeof uploadChunk;
    };
    internals.localChunks = [source];
    internals.recorder = { state: "inactive" };
    internals.state = "recording";
    internals.uploadMode = "streaming";
    internals.resetUploadedChunks = resetUploadedChunks;
    internals.uploadChunk = uploadChunk;

    await expect(engine.stop()).rejects.toThrow(
      "You're offline. Connect to the internet, then try uploading your recording again.",
    );

    expect(resetUploadedChunks).not.toHaveBeenCalled();
    expect(uploadChunk).not.toHaveBeenCalled();
    expect(internals.state).toBe("error");
    expect(engine.canRetryUpload()).toBe(true);
  });

  it("continues streaming when an IndexedDB backup write fails", async () => {
    vi.mocked(putRecordingBackupChunk).mockRejectedValueOnce(
      new Error("IndexedDB quota exceeded"),
    );
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    const onError = vi.fn();
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
      uploadMode: "streaming",
      uploadUrl: "/api/uploads/rec-1/chunk",
      abortUrl: "/api/uploads/rec-1/abort",
      onError,
    });
    const internals = engine as unknown as {
      displayStream: FakeMediaStream;
      localChunks: Blob[];
    };
    internals.displayStream = new FakeMediaStream([new FakeVideoTrack()]);
    await engine.start();

    const source = new Blob([new Uint8Array(STREAM_CHUNK_BYTES)], {
      type: "video/webm",
    });
    FakeMediaRecorder.instance!.emitChunk(source);

    await vi.waitFor(() => {
      expect(uploadChunkRequest).toHaveBeenCalledOnce();
    });
    expect(internals.localChunks).toEqual([source]);
    expect(onError).not.toHaveBeenCalled();
    expect(putRecordingBackupMeta).not.toHaveBeenCalled();
  });
});
