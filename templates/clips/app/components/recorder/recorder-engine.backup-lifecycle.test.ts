import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRecordingBackupChunks,
  getRecordingBackupMeta,
  listRecordingBackupMetas,
  readRecoverableRecordingBackup,
} from "@/lib/recording-backup";

import { RecorderEngine } from "./recorder-engine";

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

/**
 * Like a real MediaRecorder, `stop()` returns at once and the final chunk and
 * the `stop` event arrive later.
 */
class AsyncFinalChunkRecorder extends EventTarget {
  static instance: AsyncFinalChunkRecorder | null = null;
  static isTypeSupported(): boolean {
    return true;
  }
  readonly mimeType = "video/webm";
  state: RecordingState = "inactive";
  constructor(..._args: unknown[]) {
    super();
    AsyncFinalChunkRecorder.instance = this;
  }
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
    setTimeout(() => {
      this.emitChunk(new Blob(["tail"], { type: "video/webm" }));
      this.dispatchEvent(new Event("stop"));
    }, 5);
  }
  pause(): void {}
  resume(): void {}
  emitChunk(blob: Blob): void {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", { value: blob });
    this.dispatchEvent(event);
  }
}

async function startedEngine() {
  const engine = new RecorderEngine({
    recordingId: "__pending__",
    mode: "screen",
    uploadUrl: "",
    abortUrl: "",
  });
  engine.setLocalOnlyTarget("local-1");
  engine.setBackupDetails({ ownerEmail: "me@example.com", title: "Demo" });
  (engine as unknown as { displayStream: FakeMediaStream }).displayStream =
    new FakeMediaStream([new FakeVideoTrack()]);
  await engine.start();
  return engine;
}

async function written(engine: RecorderEngine) {
  await (engine as unknown as { backupMirrorQueue: Promise<void> })
    .backupMirrorQueue;
}

describe("RecorderEngine local copy lifecycle (IndexedDB)", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.stubGlobal("MediaRecorder", AsyncFinalChunkRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    AsyncFinalChunkRecorder.instance = null;
  });

  it("never lets the final chunk recreate a discarded copy", async () => {
    const engine = await startedEngine();
    AsyncFinalChunkRecorder.instance!.emitChunk(new Blob(["head"]));
    await written(engine);

    await engine.cancel("user_cancelled");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await written(engine);

    expect(await getRecordingBackupMeta("local-1")).toBeNull();
    expect(await getRecordingBackupChunks("local-1")).toEqual([]);
  });

  it("resolves release only after the final chunk is in the copy", async () => {
    const engine = await startedEngine();
    AsyncFinalChunkRecorder.instance!.emitChunk(new Blob(["head"]));
    await written(engine);

    await engine.release();

    const chunks = await getRecordingBackupChunks("local-1");
    expect(await Promise.all(chunks.map((c) => c.blob.text()))).toEqual([
      "head",
      "tail",
    ]);
    expect(await getRecordingBackupMeta("local-1")).toMatchObject({
      chunkCount: 2,
    });
  });

  it("makes the copy findable before its first chunk exists", async () => {
    const engine = await startedEngine();
    await written(engine);

    expect(await listRecordingBackupMetas()).toEqual([
      expect.objectContaining({
        recordingId: "local-1",
        state: "recording",
        chunkCount: 0,
        ownerEmail: "me@example.com",
        title: "Demo",
      }),
    ]);
  });

  it("waits for the final chunk of a Stop already in flight before releasing", async () => {
    const engine = await startedEngine();
    AsyncFinalChunkRecorder.instance!.emitChunk(new Blob(["head"]));

    void engine.stop();
    await engine.release();

    const chunks = await getRecordingBackupChunks("local-1");
    expect(await Promise.all(chunks.map((c) => c.blob.text()))).toEqual([
      "head",
      "tail",
    ]);
    expect(await getRecordingBackupMeta("local-1")).toMatchObject({
      chunkCount: 2,
      completedAt: expect.any(String),
    });
  });

  it("lists only the chunks already stored when Stop marks the copy finished", async () => {
    const engine = await startedEngine();
    const recorder = AsyncFinalChunkRecorder.instance!;
    recorder.emitChunk(new Blob(["head"]));
    await written(engine);
    // Hold the write queue so Stop's "finished" write waits behind it.
    const internals = engine as unknown as { backupMirrorQueue: Promise<void> };
    let openQueue!: () => void;
    internals.backupMirrorQueue = internals.backupMirrorQueue.then(
      () => new Promise<void>((resolve) => (openQueue = resolve)),
    );
    const stopped = engine.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // One more chunk lands while that write still waits, and its own write
    // then fails, as on a full disk.
    recorder.emitChunk(new Blob(["late"]));
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (
        this.name === "chunks" &&
        (args[0] as { index?: number }).index === 2
      ) {
        throw new DOMException("disk full", "QuotaExceededError");
      }
      return put.apply(this, args);
    });
    openQueue();
    await stopped;
    await written(engine);
    vi.restoreAllMocks();

    const copy = await readRecoverableRecordingBackup("local-1");
    expect(copy?.meta).toMatchObject({ chunkCount: 2 });
    expect(copy?.whole).toBe(true);
    expect(await copy?.blob?.text()).toBe("headtail");
  });

  it("keeps a finished copy finished when one more chunk arrives after Stop", async () => {
    const engine = await startedEngine();
    const recorder = AsyncFinalChunkRecorder.instance!;
    recorder.stop = function stopWithTwoChunks(this: AsyncFinalChunkRecorder) {
      this.state = "inactive";
      setTimeout(() => this.emitChunk(new Blob(["mid"])), 1);
      setTimeout(() => {
        this.emitChunk(new Blob(["tail"]));
        this.dispatchEvent(new Event("stop"));
      }, 10);
    };
    recorder.emitChunk(new Blob(["head"]));

    await engine.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await written(engine);

    expect(await getRecordingBackupMeta("local-1")).toMatchObject({
      state: "recorded-local",
      chunkCount: 3,
      completedAt: expect.any(String),
    });
  });
});
