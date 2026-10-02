import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteRecordingBackup,
  putRecordingBackupChunk,
  putRecordingBackupMeta,
  updateRecordingBackupMeta,
} from "@/lib/recording-backup";
import { uploadChunkRequest } from "@/lib/upload-request";

import { RecorderEngine } from "./recorder-engine";

vi.mock("@/lib/recording-backup", async (importOriginal) => ({
  verifyServerCopy: (
    await importOriginal<typeof import("@/lib/recording-backup")>()
  ).verifyServerCopy,
  deleteRecordingBackup: vi.fn(async () => {}),
  putRecordingBackupChunk: vi.fn(async () => {}),
  putRecordingBackupMeta: vi.fn(async () => {}),
  updateRecordingBackupMeta: vi.fn(async () => ({})),
}));

vi.mock("@/lib/upload-request", () => ({
  uploadChunkRequest: vi.fn(async () => Response.json({ ok: true })),
}));

class FakeVideoTrack {
  readonly kind = "video";
  readonly readyState = "live";
  getSettings(): MediaTrackSettings {
    return { width: 1280, height: 720 };
  }
  addEventListener(): void {}
  stop(): void {}
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeVideoTrack[] = []) {}
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
    this.emitChunk(new Blob(["tail"], { type: "video/webm" }));
  }
  pause(): void {}
  resume(): void {}
  emitChunk(blob: Blob): void {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", { value: blob });
    this.dispatchEvent(event);
  }
}

async function startedEngine(onLocalCopyFailed = vi.fn()) {
  const engine = new RecorderEngine({
    recordingId: "__pending__",
    mode: "screen",
    uploadUrl: "",
    abortUrl: "",
    onLocalCopyFailed,
  });
  engine.setLocalOnlyTarget("local-1");
  engine.setBackupDetails({ ownerEmail: "me@example.com", title: "Demo" });
  (engine as unknown as { displayStream: FakeMediaStream }).displayStream =
    new FakeMediaStream([new FakeVideoTrack()]);
  await engine.start();
  return engine;
}

async function flush(engine: RecorderEngine) {
  await (engine as unknown as { backupMirrorQueue: Promise<void> })
    .backupMirrorQueue;
}

describe("RecorderEngine local copy", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.mocked(putRecordingBackupChunk).mockResolvedValue(undefined);
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    FakeMediaRecorder.instance = null;
  });

  it("records with no storage into the local copy and never uploads", async () => {
    const engine = await startedEngine();
    FakeMediaRecorder.instance!.emitChunk(new Blob(["header"]));

    const result = await engine.stop();

    expect(result.localOnly).toBe(true);
    expect(uploadChunkRequest).not.toHaveBeenCalled();
    expect(putRecordingBackupChunk).toHaveBeenCalledWith(
      "local-1",
      0,
      expect.any(Blob),
    );
    expect(putRecordingBackupMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "local-1",
        state: "recording",
        localOnly: true,
        ownerEmail: "me@example.com",
        title: "Demo",
      }),
    );
    expect(putRecordingBackupMeta).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recordingId: "local-1",
        state: "recorded-local",
        chunkCount: 2,
      }),
    );
    expect(deleteRecordingBackup).not.toHaveBeenCalled();
    expect(engine.hasRecordingAtRisk()).toBe(true);
  });

  it("keeps the local copy when the page releases the recorder", async () => {
    const engine = await startedEngine();
    FakeMediaRecorder.instance!.emitChunk(new Blob(["header"]));

    engine.release();
    await flush(engine);

    expect(deleteRecordingBackup).not.toHaveBeenCalled();
    expect(putRecordingBackupChunk).toHaveBeenCalled();
  });

  it("deletes the local copy only on an explicit discard", async () => {
    const engine = await startedEngine();
    FakeMediaRecorder.instance!.emitChunk(new Blob(["header"]));

    await engine.cancel("user_cancelled");
    await flush(engine);

    expect(deleteRecordingBackup).toHaveBeenCalledWith("local-1");
  });

  it("warns once and keeps the memory copy when the browser is out of storage", async () => {
    vi.mocked(putRecordingBackupChunk).mockRejectedValue(
      new DOMException("The quota has been exceeded.", "QuotaExceededError"),
    );
    const onLocalCopyFailed = vi.fn();
    const engine = await startedEngine(onLocalCopyFailed);
    FakeMediaRecorder.instance!.emitChunk(new Blob(["a"]));
    FakeMediaRecorder.instance!.emitChunk(new Blob(["b"]));
    await flush(engine);

    expect(onLocalCopyFailed).toHaveBeenCalledOnce();
    expect(onLocalCopyFailed).toHaveBeenCalledWith("quota");
    expect(putRecordingBackupChunk).toHaveBeenCalledOnce();
    expect(engine.getBackupError()?.name).toBe("QuotaExceededError");
    await engine.stop();
    expect(engine.getBufferedRecordingSource()).toMatchObject({
      ownerEmail: "me@example.com",
    });
    expect(engine.getBufferedRecordingSource()?.blob.size).toBe(
      "a".length + "b".length + "tail".length,
    );
  });

  it("retries a transient local-copy write instead of giving up on it", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(putRecordingBackupChunk)
        .mockRejectedValueOnce(new DOMException("busy", "UnknownError"))
        .mockResolvedValue(undefined);
      const onLocalCopyFailed = vi.fn();
      const engine = await startedEngine(onLocalCopyFailed);
      FakeMediaRecorder.instance!.emitChunk(new Blob(["a"]));
      await vi.advanceTimersByTimeAsync(5_000);
      await flush(engine);

      expect(putRecordingBackupChunk).toHaveBeenCalledTimes(2);
      expect(onLocalCopyFailed).not.toHaveBeenCalled();
      expect(engine.getBackupError()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns once it runs out of retries for a failing local copy", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(putRecordingBackupChunk).mockRejectedValue(
        new DOMException("broken", "UnknownError"),
      );
      const onLocalCopyFailed = vi.fn();
      const engine = await startedEngine(onLocalCopyFailed);
      FakeMediaRecorder.instance!.emitChunk(new Blob(["a"]));
      await vi.advanceTimersByTimeAsync(10_000);
      await flush(engine);

      expect(putRecordingBackupChunk).toHaveBeenCalledTimes(4);
      expect(onLocalCopyFailed).toHaveBeenCalledWith("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the copy incomplete and says so when the final chunk never arrives", async () => {
    vi.useFakeTimers();
    try {
      const onIncompleteCapture = vi.fn();
      const engine = new RecorderEngine({
        recordingId: "__pending__",
        mode: "screen",
        uploadUrl: "",
        abortUrl: "",
        onIncompleteCapture,
      });
      engine.setLocalOnlyTarget("local-1");
      (engine as unknown as { displayStream: FakeMediaStream }).displayStream =
        new FakeMediaStream([new FakeVideoTrack()]);
      await engine.start();
      const recorder = FakeMediaRecorder.instance!;
      recorder.stop = function stopWithoutFinalChunk(this: FakeMediaRecorder) {
        this.state = "inactive";
      };
      recorder.emitChunk(new Blob(["a"]));

      const stopping = engine.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      await stopping;

      expect(onIncompleteCapture).toHaveBeenCalledOnce();
      expect(updateRecordingBackupMeta).toHaveBeenCalledWith("local-1", {
        incomplete: true,
      });
      expect(engine.getBufferedRecordingSource()?.whole).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
