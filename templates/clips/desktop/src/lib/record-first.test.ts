import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ open: vi.fn(), stat: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);

import {
  changeRecordFirstFiles,
  effectiveLocalRecordingMode,
  loadRecordFirstFiles,
  RecordFirstFileMissingError,
  RecordFirstFileUnreadableError,
  recordFirstFilesKey,
  RecordFirstHandoffResetError,
  recordFirstFilesToQueue,
  recordFirstMediaFlags,
  saveRecordFirstFiles,
  stageRecordFirstFile,
  stagedIdAfterFailure,
  transferRecordFirstFiles,
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

  it("changes the stored list, not a stale copy of it", () => {
    const storage = memoryStorage();
    saveRecordFirstFiles(storage, "k", [file]);
    const later = { ...file, path: "/later.webm", fileName: "later.webm" };

    // Another change landed in storage after this caller read its state.
    changeRecordFirstFiles(storage, "k", (files) => [...files, later]);
    const next = changeRecordFirstFiles(storage, "k", (files) =>
      files.map((f) =>
        f.path === file.path ? { ...f, stagedRecordingId: "r1" } : f,
      ),
    );

    expect(next.map((f) => [f.path, f.stagedRecordingId])).toEqual([
      [file.path, "r1"],
      ["/later.webm", undefined],
    ]);
    expect(loadRecordFirstFiles(storage, "k")).toEqual(next);
  });

  describe("moving unclaimed files to an account", () => {
    const a = { ...file, path: "/a.webm", fileName: "a.webm" };
    const b = { ...file, path: "/b.webm", fileName: "b.webm" };
    const mine = { ...file, path: "/mine.webm", fileName: "mine.webm" };

    function paths(storage: ReturnType<typeof memoryStorage>, key: string) {
      return loadRecordFirstFiles(storage, key).map((f) => f.path);
    }

    /** Every moving file is in exactly one list, never neither or both. */
    function expectEachListedOnce(storage: ReturnType<typeof memoryStorage>) {
      const all = [...paths(storage, "acct"), ...paths(storage, "unclaimed")];
      for (const path of ["/a.webm", "/b.webm", "/mine.webm"]) {
        expect(all.filter((p) => p === path)).toHaveLength(1);
      }
    }

    function seeded() {
      const storage = memoryStorage();
      saveRecordFirstFiles(storage, "acct", [mine]);
      saveRecordFirstFiles(storage, "unclaimed", [a, b]);
      return storage;
    }

    it("adds them to the account and only then empties the unclaimed list", () => {
      const storage = seeded();

      transferRecordFirstFiles(storage, "unclaimed", "acct");

      expect(paths(storage, "acct")).toEqual([
        "/mine.webm",
        "/a.webm",
        "/b.webm",
      ]);
      expect(paths(storage, "unclaimed")).toEqual([]);
    });

    it("keeps the unclaimed list untouched when the account write fails", () => {
      const storage = seeded();
      const setItem = storage.setItem;
      storage.setItem = (key: string, value: string) => {
        if (key === "acct")
          throw new DOMException("full", "QuotaExceededError");
        setItem(key, value);
      };

      expect(() =>
        transferRecordFirstFiles(storage, "unclaimed", "acct"),
      ).toThrow("full");
      expect(paths(storage, "unclaimed")).toEqual(["/a.webm", "/b.webm"]);
      expect(paths(storage, "acct")).toEqual(["/mine.webm"]);
    });

    it("keeps the unclaimed list when the account write does not read back", () => {
      const storage = seeded();
      const setItem = storage.setItem;
      storage.setItem = (key: string, value: string) =>
        // The write appears to succeed but does not hold.
        key === "acct" ? undefined : setItem(key, value);

      expect(() =>
        transferRecordFirstFiles(storage, "unclaimed", "acct"),
      ).toThrow("couldn't add");
      expect(paths(storage, "unclaimed")).toEqual(["/a.webm", "/b.webm"]);
    });

    it("never duplicates a file when a crash hit before the unclaimed list was cleared", () => {
      const storage = seeded();
      const setItem = storage.setItem;
      const removeItem = storage.removeItem;
      storage.removeItem = (key: string) => {
        if (key === "unclaimed") throw new Error("app quit");
        removeItem(key);
      };

      expect(() =>
        transferRecordFirstFiles(storage, "unclaimed", "acct"),
      ).toThrow("app quit");
      // After the "crash" the files are in both lists, never in neither.
      expect(paths(storage, "acct")).toEqual([
        "/mine.webm",
        "/a.webm",
        "/b.webm",
      ]);
      expect(paths(storage, "unclaimed")).toEqual(["/a.webm", "/b.webm"]);

      storage.setItem = setItem;
      storage.removeItem = removeItem;
      transferRecordFirstFiles(storage, "unclaimed", "acct");
      expectEachListedOnce(storage);
    });

    it("refuses an unreadable unclaimed list without touching either list", () => {
      const storage = seeded();
      storage.setItem("unclaimed", "{not json");

      expect(() =>
        transferRecordFirstFiles(storage, "unclaimed", "acct"),
      ).toThrow();
      expect(storage.getItem("unclaimed")).toBe("{not json");
      expect(paths(storage, "acct")).toEqual(["/mine.webm"]);
    });
  });

  it("describes each separate file by what it holds", () => {
    const take = { hasAudio: true, hasCamera: true };

    expect(recordFirstMediaFlags("composed", take)).toEqual(take);
    expect(recordFirstMediaFlags("desktop", take)).toEqual({
      hasAudio: true,
      hasCamera: false,
    });
    expect(recordFirstMediaFlags("camera", take)).toEqual({
      hasAudio: false,
      hasCamera: true,
    });
  });

  it("queues the composed file, or every file when a capture wrote none", () => {
    const composed = { role: "composed", path: "/c.webm" };
    const desktop = { role: "desktop", path: "/d.webm" };
    const camera = { role: "camera", path: "/cam.webm" };

    expect(recordFirstFilesToQueue([desktop, composed])).toEqual([composed]);
    expect(recordFirstFilesToQueue([desktop, camera])).toEqual([
      desktop,
      camera,
    ]);
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
    vi.restoreAllMocks();
    fs.open.mockReset();
    fs.stat.mockReset();
    fetchMock.mockReset();
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

  function serverWith(status: Record<string, number | object>) {
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/create-recording")) {
        return Response.json({
          result: { id: "rec-9", uploadMode: "streaming" },
        });
      }
      const match = path.match(/\/api\/uploads\/([^/]+)\/status$/);
      if (match) {
        const row = status[match[1]!];
        return row === undefined
          ? Response.json({ error: "Not found" }, { status: 404 })
          : Response.json({ recording: row });
      }
      return new Response("{}", { status: 200 });
    });
  }

  it("creates the row and queues the saved file as a pending upload", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "rec-9" as ReturnType<typeof crypto.randomUUID>,
    );
    const handle = openFile(new Uint8Array(10).fill(7));
    serverWith({});

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

  const notFound = new Error(
    "failed to get metadata of path: /x with error: No such file or directory (os error 2)",
  );

  it("keeps a file it cannot read now, and creates nothing", async () => {
    fs.open.mockRejectedValue(
      new Error("Operation not permitted (os error 1)"),
    );
    fs.stat.mockResolvedValue({ size: 10 });

    const error = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RecordFirstFileUnreadableError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listBrowserRecordingBackups()).toEqual([]);
  });

  it("calls a file missing only when it is gone from a folder that is still there", async () => {
    fs.open.mockRejectedValue(notFound);
    fs.stat.mockImplementation(async (path: string) => {
      if (path === file.path) throw notFound;
      return { size: 0, isDirectory: true };
    });

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toBeInstanceOf(RecordFirstFileMissingError);
  });

  it("never calls a file missing when its folder cannot be read (an unmounted volume)", async () => {
    fs.open.mockRejectedValue(notFound);
    fs.stat.mockRejectedValue(notFound);

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toBeInstanceOf(RecordFirstFileUnreadableError);
  });

  it("never calls a file missing when the file system refuses for another reason", async () => {
    fs.open.mockRejectedValue(new Error("Permission denied (os error 13)"));
    fs.stat.mockRejectedValue(new Error("Permission denied (os error 13)"));

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toBeInstanceOf(RecordFirstFileUnreadableError);
  });

  it("reuses a copy a crash left staged instead of creating another clip", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "rec-9" as ReturnType<typeof crypto.randomUUID>,
    );
    openFile(new Uint8Array(10).fill(7));
    serverWith({});
    const first = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file: { ...file, stagedRecordingId: "rec-9" },
    });
    fetchMock.mockClear();
    fs.open.mockClear();

    // The app quit before the list entry was removed; Upload now runs again.
    const again = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file: { ...file, stagedRecordingId: "rec-9" },
    });

    expect(again).toMatchObject({ recordingId: first!.recordingId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.open).not.toHaveBeenCalled();
    expect(await listBrowserRecordingBackups()).toHaveLength(1);
  });

  it("restages into the same row when a crash cut staging off", async () => {
    openFile(new Uint8Array(10).fill(7));
    serverWith({ "rec-7": { status: "uploading" } });

    const upload = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file: { ...file, stagedRecordingId: "rec-7" },
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.endsWith("/create-recording"))).toBe(false);
    expect(upload).toMatchObject({ recordingId: "rec-7", bytes: 10 });
  });

  it("keeps the staged id after a create cut off mid-flight, and reuses that row", async () => {
    openFile(new Uint8Array(10).fill(7));
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/status")) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      // The server inserts the row, but the response never arrives.
      if (path.endsWith("/create-recording"))
        throw new TypeError("network lost");
      return new Response("{}", { status: 200 });
    });
    const staged = { ...file, stagedRecordingId: "rec-7" };

    const error = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file: staged,
    }).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(RecordFirstHandoffResetError);
    expect(stagedIdAfterFailure("rec-7", error)).toBe("rec-7");

    // The retry finds the row the cut-off create inserted and stages into it.
    fetchMock.mockClear();
    openFile(new Uint8Array(10).fill(7));
    serverWith({ "rec-7": { status: "uploading" } });
    const upload = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file: staged,
    });
    expect(upload).toMatchObject({ recordingId: "rec-7" });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/create-recording"),
      ),
    ).toBe(false);
  });

  it("trashes an earlier attempt that ended failed and only then drops its id", async () => {
    openFile(new Uint8Array(10).fill(7));
    serverWith({ "rec-7": { status: "failed" } });

    const error = await queueRecordFirstUpload({
      serverUrl: "https://clips.example",
      ownerEmail: "me@example.com",
      file: { ...file, stagedRecordingId: "rec-7" },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RecordFirstHandoffResetError);
    expect(stagedIdAfterFailure("rec-7", error)).toBeUndefined();
    const trash = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/trash-recording"),
    );
    expect(JSON.parse(String(trash?.[1]?.body))).toEqual({ id: "rec-7" });
  });

  it("hands off nothing when the staged copy already uploaded before a crash", async () => {
    openFile(new Uint8Array(10).fill(7));
    serverWith({ "rec-7": { status: "ready" } });

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file: { ...file, stagedRecordingId: "rec-7" },
      }),
    ).resolves.toBeNull();
    expect(await listBrowserRecordingBackups()).toEqual([]);
  });

  it("fails loudly and cleans up when the file changes while it is staged", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "rec-9" as ReturnType<typeof crypto.randomUUID>,
    );
    const handle = openFile(new Uint8Array(10).fill(7));
    handle.stat.mockResolvedValue({ size: 12 });
    serverWith({});

    await expect(
      queueRecordFirstUpload({
        serverUrl: "https://clips.example",
        ownerEmail: "me@example.com",
        file,
      }),
    ).rejects.toThrow("changed while it was being queued");
    expect(await listBrowserRecordingBackups()).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      "https://clips.example/api/uploads/rec-9/abort",
    );
  });

  it("never calls a file missing because the server said Not Found", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "rec-9" as ReturnType<typeof crypto.randomUUID>,
    );
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
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "rec-9" as ReturnType<typeof crypto.randomUUID>,
    );
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
    ).rejects.toThrow(RecordFirstHandoffResetError);

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("https://clips.example/api/uploads/rec-9/abort");
    expect(urls).toContain(
      "https://clips.example/_agent-native/actions/trash-recording",
    );
    expect(await listBrowserRecordingBackups()).toEqual([]);
    expect(handle.close).toHaveBeenCalledOnce();
  });
});
