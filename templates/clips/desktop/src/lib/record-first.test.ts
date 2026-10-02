import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: readFileMock }));

import {
  effectiveLocalRecordingMode,
  isMissingRecordFirstFile,
  loadRecordFirstFiles,
  recordFirstBackup,
  recordFirstFilesKey,
  saveRecordFirstFiles,
  type RecordFirstFile,
} from "./record-first";
import {
  listBrowserRecordingBackups,
  queueRecordFirstUpload,
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

  it("recognises a missing file so its entry can be dismissed", () => {
    expect(
      isMissingRecordFirstFile(
        "failed to open file at path: /x.webm with error: No such file or directory (os error 2)",
      ),
    ).toBe(true);
    expect(isMissingRecordFirstFile("create-recording 503: busy")).toBe(false);
  });

  it("reports an unreadable list instead of hiding saved files", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not json");
    expect(() => loadRecordFirstFiles(storage, "k")).toThrow();
  });
});

describe("recordFirstBackup", () => {
  it("splits the file into a backup the retry path accepts", () => {
    const bytes = new Uint8Array(10).map((_, i) => i);
    const { meta, chunks } = recordFirstBackup({
      recordingId: "rec-1",
      serverUrl: "https://clips.example/",
      file,
      bytes,
      chunkBytes: 4,
    });

    expect(chunks.map((chunk) => chunk.bytes)).toEqual([4, 4, 2]);
    expect(meta).toMatchObject({
      recordingId: "rec-1",
      serverUrl: "https://clips.example",
      bytes: 10,
      chunkCount: 3,
    });
    expect(validateBrowserRecordingBackupChunks(meta, chunks)).toHaveLength(3);
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

  it("creates the row and queues the saved file as a pending upload", async () => {
    readFileMock.mockResolvedValue(new Uint8Array(10).fill(7));
    fetchMock.mockResolvedValue(
      Response.json({ result: { id: "rec-9", uploadMode: "streaming" } }),
    );

    const upload = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file,
    });

    expect(readFileMock).toHaveBeenCalledWith(file.path);
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
    readFileMock.mockRejectedValue(new Error("forbidden path"));

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toThrow("forbidden path");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listBrowserRecordingBackups()).toEqual([]);
  });
});
