import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ open: vi.fn(), exists: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);

import {
  effectiveLocalRecordingMode,
  loadRecordFirstFiles,
  RecordFirstFileMissingError,
  recordFirstFilesKey,
  saveRecordFirstFiles,
  stageRecordFirstFile,
  type RecordFirstChunk,
  type RecordFirstFile,
} from "./record-first";
import {
  listBrowserRecordingBackups,
  queueRecordFirstUpload,
  STREAM_CHUNK_BYTES,
  validateBrowserRecordingBackupChunks,
} from "./recorder";

const file: RecordFirstFile = {
  role: "composed",
  path: "/Users/me/Movies/Clips/2026-10-01/clip.webm",
  fileName: "clip.webm",
  mimeType: "video/webm",
  bytes: 10,
  durationMs: 4_000,
  width: 1280,
  height: 720,
  hasAudio: true,
  hasCamera: false,
  savedAt: "2026-10-01T10:00:00.000Z",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("effectiveLocalRecordingMode", () => {
  it.each(["checking", "missing"] as const)(
    "records to disk instead of waiting when storage is %s",
    (status) => {
      expect(effectiveLocalRecordingMode("off", status)).toBe("composed");
    },
  );

  it("streams to the server once storage reads as connected", () => {
    expect(effectiveLocalRecordingMode("off", "configured")).toBe("off");
  });

  it("keeps an explicit local mode", () => {
    expect(effectiveLocalRecordingMode("separate", "missing")).toBe("separate");
  });
});

describe("record-first file list", () => {
  it("is kept per account and round-trips", () => {
    const storage = memoryStorage();
    const mine = recordFirstFilesKey("https://clips.example", "Me@Example.com");
    const theirs = recordFirstFilesKey("https://clips.example", "other@x.com");

    saveRecordFirstFiles(storage, mine, [file]);

    expect(loadRecordFirstFiles(storage, mine)).toEqual([file]);
    expect(loadRecordFirstFiles(storage, theirs)).toEqual([]);
    saveRecordFirstFiles(storage, mine, []);
    expect(storage.getItem(mine)).toBeNull();
  });

  it("keeps a file saved while signed out apart, for an explicit claim", () => {
    const storage = memoryStorage();
    const unclaimed = recordFirstFilesKey("https://clips.example", null);
    saveRecordFirstFiles(storage, unclaimed, [file]);

    expect(unclaimed).toContain("unclaimed");
    expect(
      loadRecordFirstFiles(
        storage,
        recordFirstFilesKey("https://clips.example", "me@example.com"),
      ),
    ).toEqual([]);
    expect(loadRecordFirstFiles(storage, unclaimed)).toEqual([file]);
  });

  it("reports an unreadable list instead of hiding saved files", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not json");
    expect(() => loadRecordFirstFiles(storage, "k")).toThrow();
  });

  it("sets an unreadable list aside instead of overwriting it", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not json");

    saveRecordFirstFiles(storage, "k", [file], 123);

    expect(loadRecordFirstFiles(storage, "k")).toEqual([file]);
    expect(storage.getItem("k:unreadable:123")).toBe("{not json");
  });
});

/** A file read the way the fs plugin reads: up to `max` bytes per call. */
function fileReader(bytes: Uint8Array, max = Infinity) {
  let offset = 0;
  return vi.fn(async (buffer: Uint8Array) => {
    const n = Math.min(buffer.byteLength, max, bytes.byteLength - offset);
    if (n <= 0) return null;
    buffer.set(bytes.subarray(offset, offset + n));
    offset += n;
    return n;
  });
}

describe("stageRecordFirstFile", () => {
  async function stage(size: number, chunkBytes: number, max?: number) {
    const bytes = new Uint8Array(size).map((_, i) => i % 251);
    const chunks: RecordFirstChunk[] = [];
    const meta = await stageRecordFirstFile({
      recordingId: "rec-1",
      serverUrl: "https://clips.example/",
      file,
      read: fileReader(bytes, max),
      putChunk: async (chunk) => void chunks.push(chunk),
      chunkBytes,
    });
    const staged = new Uint8Array(
      await new Blob(chunks.map((c) => c.blob)).arrayBuffer(),
    );
    return { bytes, chunks, meta, staged };
  }

  it("ends with a short last slice and a backup the retry path accepts", async () => {
    const { bytes, chunks, meta, staged } = await stage(10, 4);

    expect(chunks.map((chunk) => chunk.bytes)).toEqual([4, 4, 2]);
    expect(staged).toEqual(bytes);
    expect(meta).toMatchObject({
      recordingId: "rec-1",
      serverUrl: "https://clips.example",
      bytes: 10,
      chunkCount: 3,
    });
    expect(validateBrowserRecordingBackupChunks(meta, chunks)).toHaveLength(3);
  });

  it("stages an exact multiple without an empty trailing slice", async () => {
    const { chunks, meta } = await stage(8, 4);

    expect(chunks.map((chunk) => chunk.bytes)).toEqual([4, 4]);
    expect(meta.chunkCount).toBe(2);
  });

  it("fills each slice across short reads", async () => {
    const { bytes, chunks, staged } = await stage(10, 4, 3);

    expect(chunks.map((chunk) => chunk.bytes)).toEqual([4, 4, 2]);
    expect(staged).toEqual(bytes);
  });

  it("refuses an empty file and stages nothing", async () => {
    const putChunk = vi.fn();
    await expect(
      stageRecordFirstFile({
        recordingId: "rec-1",
        serverUrl: "https://clips.example",
        file,
        read: fileReader(new Uint8Array(0)),
        putChunk,
        chunkBytes: 4,
      }),
    ).rejects.toThrow("clip.webm is empty");
    expect(putChunk).not.toHaveBeenCalled();
  });
});

describe("queueRecordFirstUpload", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function openFile(bytes: Uint8Array, read = fileReader(bytes)) {
    const handle = {
      stat: vi.fn(async () => ({ size: bytes.byteLength })),
      read,
      close: vi.fn(async () => {}),
    };
    fs.open.mockResolvedValue(handle);
    return handle;
  }

  it("creates the row and queues the saved file as a pending upload", async () => {
    const handle = openFile(new Uint8Array(10).fill(7));
    fetchMock.mockResolvedValue(
      Response.json({ result: { id: "rec-9", uploadMode: "streaming" } }),
    );

    const upload = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file,
    });

    expect(fs.open).toHaveBeenCalledWith(file.path, { read: true });
    expect(handle.close).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({
      requestStreaming: true,
      hasAudio: true,
      expectedOwnerEmail: "me@example.com",
    });
    expect(upload).toMatchObject({ kind: "browser", recordingId: "rec-9" });
    expect(await listBrowserRecordingBackups()).toEqual([
      expect.objectContaining({ recordingId: "rec-9", bytes: 10 }),
    ]);
  });

  it("creates nothing when the saved file cannot be read", async () => {
    fs.open.mockRejectedValue(new Error("forbidden path"));
    fs.exists.mockResolvedValue(true);

    const error = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file,
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ message: "forbidden path" });
    expect(error).not.toBeInstanceOf(RecordFirstFileMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listBrowserRecordingBackups()).toEqual([]);
  });

  it("calls a file missing only when the file system says it is gone", async () => {
    fs.open.mockRejectedValue(new Error("No such file or directory"));
    fs.exists.mockResolvedValue(false);

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toBeInstanceOf(RecordFirstFileMissingError);
  });

  it("never calls a file missing because the server said Not Found", async () => {
    openFile(new Uint8Array(10).fill(7));
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/create-recording")
        ? new Response('{"statusMessage":"Not Found"}', { status: 404 })
        : new Response("{}", { status: 200 }),
    );

    const error = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file,
    }).catch((e: unknown) => e);

    expect(String(error)).toContain("404");
    expect(error).not.toBeInstanceOf(RecordFirstFileMissingError);
  });

  it("cleans up the new row and the partial copy when staging fails", async () => {
    const bytes = new Uint8Array(STREAM_CHUNK_BYTES + 10).fill(7);
    const reader = fileReader(bytes);
    let reads = 0;
    const handle = openFile(
      bytes,
      vi.fn(async (buffer: Uint8Array) => {
        reads += 1;
        // The disk fails after the first slice was staged.
        if (reads > 1) throw new Error("disk read failed");
        return reader(buffer);
      }),
    );
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/create-recording")
        ? Response.json({ result: { id: "rec-9", uploadMode: "streaming" } })
        : new Response("{}", { status: 200 }),
    );

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toThrow("disk read failed");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("https://clips.example/api/uploads/rec-9/abort");
    expect(urls).toContain(
      "https://clips.example/_agent-native/actions/trash-recording",
    );
    expect(await listBrowserRecordingBackups()).toEqual([]);
    expect(handle.close).toHaveBeenCalledOnce();
  });
});
