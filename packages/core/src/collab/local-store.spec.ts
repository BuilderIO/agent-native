/**
 * Saved page copies: one account's never reach another, a sign-out clears
 * them, they stay bounded, and storage that cannot be used reads as
 * "unavailable" rather than as an empty copy.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLLAB_LOCAL_COPY_LIMITS,
  _flushCollabLocalCopiesForTests,
  _forgetCollabLocalCopiesInMemoryForTests,
  _setCollabLocalCopyPersistenceForTests,
  clearCollabLocalCopies,
  collabLocalCopyAccount,
  deleteCollabLocalCopy,
  indexedDbCollabLocalCopies,
  readCollabLocalCopy,
  saveCollabLocalCopy,
} from "./local-store.js";

const ADA = "ada@example.com";
const BOB = "bob@example.com";

let factory: IDBFactory;

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

// What a new page load sees: only what IndexedDB kept.
async function reload() {
  await _flushCollabLocalCopiesForTests();
  _forgetCollabLocalCopiesInMemoryForTests();
}

describe("collab local copies", () => {
  beforeEach(() => {
    factory = new IDBFactory();
    _setCollabLocalCopyPersistenceForTests(
      indexedDbCollabLocalCopies(() => factory),
    );
  });

  afterEach(() => {
    _setCollabLocalCopyPersistenceForTests(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps a copy across page loads for the account that saved it", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1, 2, 3));
    await reload();

    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "hit",
      state: bytes(1, 2, 3),
    });
    expect(await readCollabLocalCopy(ADA, "doc-2")).toEqual({
      status: "miss",
    });
    expect(await collabLocalCopyAccount()).toBe(ADA);
  });

  it("never gives one account's copy to another, and drops it when another reads", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1, 2, 3));
    await reload();

    expect(await readCollabLocalCopy(BOB, "doc-1")).toEqual({
      status: "miss",
    });
    // Bob's read cleared what Ada kept.
    await reload();
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
  });

  it("clears another account's copies when a new account saves", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    await reload();
    saveCollabLocalCopy(BOB, "doc-2", bytes(2));
    await reload();

    expect(await collabLocalCopyAccount()).toBe(BOB);
    expect(await readCollabLocalCopy(BOB, "doc-2")).toEqual({
      status: "hit",
      state: bytes(2),
    });
    await reload();
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
  });

  it("forgets everything on clear, including a read already in flight", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    await reload();

    const inFlight = readCollabLocalCopy(ADA, "doc-1");
    await clearCollabLocalCopies();
    expect(await inFlight).toEqual({ status: "miss" });

    await reload();
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
    expect(await collabLocalCopyAccount()).toBeNull();
  });

  it("keeps a save made after a clear", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    const cleared = clearCollabLocalCopies();
    saveCollabLocalCopy(ADA, "doc-2", bytes(2));
    await cleared;
    await reload();

    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
    expect(await readCollabLocalCopy(ADA, "doc-2")).toEqual({
      status: "hit",
      state: bytes(2),
    });
  });

  it("deletes one copy", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    saveCollabLocalCopy(ADA, "doc-2", bytes(2));
    deleteCollabLocalCopy(ADA, "doc-1");
    await reload();

    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
    expect((await readCollabLocalCopy(ADA, "doc-2")).status).toBe("hit");
  });

  it("does not keep a copy over the size limit, and drops the one it replaces", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    await reload();
    saveCollabLocalCopy(
      ADA,
      "doc-1",
      new Uint8Array(COLLAB_LOCAL_COPY_LIMITS.copyBytes + 1),
    );
    await reload();

    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
  });

  it("evicts the least recently opened copies past the total limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const size = COLLAB_LOCAL_COPY_LIMITS.copyBytes;
    const count = Math.floor(COLLAB_LOCAL_COPY_LIMITS.totalBytes / size);
    for (let index = 0; index < count; index += 1) {
      vi.setSystemTime(1_000 + index);
      saveCollabLocalCopy(ADA, `doc-${index}`, new Uint8Array(size));
      await _flushCollabLocalCopiesForTests();
    }
    // Opening the oldest makes it the most recent.
    vi.setSystemTime(5_000);
    await reload();
    expect((await readCollabLocalCopy(ADA, "doc-0")).status).toBe("hit");

    vi.setSystemTime(6_000);
    saveCollabLocalCopy(ADA, "doc-new", bytes(1));
    await reload();

    expect((await readCollabLocalCopy(ADA, "doc-0")).status).toBe("hit");
    expect((await readCollabLocalCopy(ADA, "doc-new")).status).toBe("hit");
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
    expect((await readCollabLocalCopy(ADA, "doc-2")).status).toBe("hit");
  });

  it("drops a copy saved in another format", async () => {
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    await reload();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("agent-native-collab-local-copies");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("states", "readwrite");
      transaction
        .objectStore("states")
        .put({ key: "doc-1", format: 2, state: bytes(9) });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();

    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
  });

  it("reads as unavailable, not empty, when IndexedDB cannot be used", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    _setCollabLocalCopyPersistenceForTests(
      indexedDbCollabLocalCopies(() => undefined),
    );

    const read = await readCollabLocalCopy(ADA, "doc-1");
    expect(read.status).toBe("unavailable");
    // Saving still works for this tab, from memory.
    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    await _flushCollabLocalCopiesForTests();
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "hit",
      state: bytes(1),
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps a copy the browser refuses to store (quota) for this tab only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stored = indexedDbCollabLocalCopies(() => factory);
    _setCollabLocalCopyPersistenceForTests({
      ...stored,
      write: () =>
        Promise.reject(new DOMException("Quota", "QuotaExceededError")),
    });

    saveCollabLocalCopy(ADA, "doc-1", bytes(1));
    await _flushCollabLocalCopiesForTests();
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "hit",
      state: bytes(1),
    });
    await reload();
    expect(await readCollabLocalCopy(ADA, "doc-1")).toEqual({
      status: "miss",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads as unavailable when opening the database fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => {
          Object.defineProperty(request, "error", {
            value: new DOMException("Quota", "QuotaExceededError"),
          });
          request.onerror?.(new Event("error"));
        });
        return request;
      },
    } as unknown as IDBFactory;
    _setCollabLocalCopyPersistenceForTests(
      indexedDbCollabLocalCopies(() => failing),
    );

    const read = await readCollabLocalCopy(ADA, "doc-1");
    expect(read.status).toBe("unavailable");
  });
});
