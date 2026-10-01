import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteRecordingBackup,
  putRecordingBackupChunk,
  putRecordingBackupMeta,
} from "@/lib/recording-backup";
import { uploadChunkRequest } from "@/lib/upload-request";

import { RecorderEngine } from "./recorder-engine";

vi.mock("@/lib/recording-backup", () => ({
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

async function startedEngine(onWarning = vi.fn()) {
  const engine = new RecorderEngine({
    recordingId: "__pending__",
    mode: "screen",
    uploadUrl: "",
    abortUrl: "",
    onWarning,
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
    const onWarning = vi.fn();
    const engine = await startedEngine(onWarning);
    FakeMediaRecorder.instance!.emitChunk(new Blob(["a"]));
    FakeMediaRecorder.instance!.emitChunk(new Blob(["b"]));
    await flush(engine);

    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0]![0]).toMatch(/out of storage/);
    expect(engine.getBackupError()?.name).toBe("QuotaExceededError");
    await engine.stop();
    expect(engine.getBufferedRecordingSource()?.blob.size).toBe(
      "a".length + "b".length + "tail".length,
    );
  });
});
