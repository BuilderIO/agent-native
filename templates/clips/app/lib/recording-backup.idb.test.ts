import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimRecordingBackupOwner,
  deleteRecordingBackup,
  getRecordingBackupChunks,
  getRecordingBackupMeta,
  putRecordingBackupChunk,
  putRecordingBackupMeta,
  readRecoverableRecordingBackup,
  updateRecordingBackupMeta,
  type RecordingBackupMeta,
} from "./recording-backup";

function meta(
  overrides: Partial<RecordingBackupMeta> = {},
): RecordingBackupMeta {
  return {
    recordingId: "rec-a",
    mimeType: "video/webm",
    durationMs: 4_000,
    width: 1280,
    height: 720,
    hasAudio: true,
    hasCamera: false,
    bytes: 4,
    chunkCount: 2,
    savedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:04.000Z",
    ...overrides,
  };
}

async function text(blob: Blob | null | undefined): Promise<string | null> {
  return blob ? await blob.text() : null;
}

describe("recording backup (IndexedDB)", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads chunks back in index order as one blob", async () => {
    await putRecordingBackupChunk("rec-a", 1, new Blob(["cd"]));
    await putRecordingBackupChunk("rec-a", 0, new Blob(["ab"]));
    await putRecordingBackupMeta(meta());

    const copy = await readRecoverableRecordingBackup("rec-a");

    expect(copy?.meta.recordingId).toBe("rec-a");
    expect(await text(copy?.blob)).toBe("abcd");
  });

  it("keeps upload state when a later chunk rewrites the meta", async () => {
    await putRecordingBackupMeta(
      meta({ completedAt: null, state: "recording" }),
    );
    await updateRecordingBackupMeta("rec-a", {
      serverRecordingId: "server-1",
      ownerEmail: "me@example.com",
    });
    await putRecordingBackupMeta(meta({ completedAt: null, chunkCount: 3 }));

    expect(await getRecordingBackupMeta("rec-a")).toMatchObject({
      chunkCount: 3,
      serverRecordingId: "server-1",
      ownerEmail: "me@example.com",
    });
  });

  it("aborts an update of a missing copy without writing anything", async () => {
    await expect(
      updateRecordingBackupMeta("missing", { lastError: "x" }),
    ).rejects.toThrow("This recording's local copy is missing.");
    expect(await getRecordingBackupMeta("missing")).toBeNull();
  });

  it("surfaces a quota failure instead of reporting the chunk saved", async () => {
    const quota = new DOMException("Quota exceeded", "QuotaExceededError");
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw quota;
    });

    await expect(
      putRecordingBackupChunk("rec-a", 0, new Blob(["ab"])),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    vi.restoreAllMocks();
    expect(await getRecordingBackupChunks("rec-a")).toEqual([]);
  });

  it("stores a chunk together with the metadata that lists it, or neither", async () => {
    await putRecordingBackupChunk(
      "rec-a",
      0,
      new Blob(["ab"]),
      meta({ completedAt: null, bytes: 2, chunkCount: 1 }),
    );
    expect(await getRecordingBackupMeta("rec-a")).toMatchObject({
      chunkCount: 1,
    });

    // The page dies mid-write: the metadata half of chunk 1 fails.
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "recordings") {
        throw new DOMException("disk full", "QuotaExceededError");
      }
      return put.apply(this, args);
    });
    await expect(
      putRecordingBackupChunk(
        "rec-a",
        1,
        new Blob(["cd"]),
        meta({ completedAt: null, chunkCount: 2 }),
      ),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    vi.restoreAllMocks();

    // Recovery still finds the copy, with exactly the chunk its metadata lists.
    expect(await getRecordingBackupMeta("rec-a")).toMatchObject({
      chunkCount: 1,
    });
    expect(
      (await getRecordingBackupChunks("rec-a")).map((c) => c.index),
    ).toEqual([0]);
    expect(
      await text((await readRecoverableRecordingBackup("rec-a"))?.blob),
    ).toBe("ab");
  });

  it("deletes one copy's meta and chunks and leaves other copies alone", async () => {
    await putRecordingBackupMeta(meta());
    await putRecordingBackupChunk("rec-a", 0, new Blob(["ab"]));
    await putRecordingBackupChunk("rec-a", 1, new Blob(["cd"]));
    await putRecordingBackupMeta(meta({ recordingId: "rec-b" }));
    await putRecordingBackupChunk("rec-b", 0, new Blob(["zz"]));

    await deleteRecordingBackup("rec-a");

    expect(await getRecordingBackupMeta("rec-a")).toBeNull();
    expect(await getRecordingBackupChunks("rec-a")).toEqual([]);
    expect(await getRecordingBackupMeta("rec-b")).not.toBeNull();
    expect(await getRecordingBackupChunks("rec-b")).toHaveLength(1);
  });

  it("stamps an ownerless copy but never reassigns another account's", async () => {
    await putRecordingBackupMeta(meta());
    await putRecordingBackupMeta(
      meta({ recordingId: "rec-b", ownerEmail: "Other@Example.com" }),
    );

    await claimRecordingBackupOwner("rec-a", "me@example.com");
    await expect(
      claimRecordingBackupOwner("rec-b", "me@example.com"),
    ).rejects.toThrow("This recording belongs to another account.");

    expect((await getRecordingBackupMeta("rec-a"))?.ownerEmail).toBe(
      "me@example.com",
    );
    expect((await getRecordingBackupMeta("rec-b"))?.ownerEmail).toBe(
      "Other@Example.com",
    );
  });
});
