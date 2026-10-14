import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction }));

import { LocalCopyOwnership } from "./local-copy-ownership";
import {
  discardLocalRecording,
  type LocalUploadResult,
} from "./local-recording-upload";
import {
  claimRecordingBackupLock,
  getRecordingBackupMeta,
  putRecordingBackupChunk,
  updateRecordingBackupMeta,
} from "./recording-backup";
import { FakeLockManager } from "./testing/fake-lock-manager";

let locks: FakeLockManager;

beforeEach(async () => {
  locks = new FakeLockManager();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("navigator", { locks });
  await putRecordingBackupChunk("rec-1", 0, new Blob(["ab"]), {
    recordingId: "rec-1",
    mimeType: "video/webm",
    durationMs: 4_000,
    width: 1,
    height: 1,
    hasAudio: true,
    hasCamera: false,
    bytes: 2,
    chunkCount: 1,
    savedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:04.000Z",
    ownerEmail: "me@example.com",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("LocalCopyOwnership", () => {
  it("shares one claim between concurrent callers for the same copy", async () => {
    const tab = new LocalCopyOwnership();

    const [first, second] = await Promise.all([
      tab.hold("rec-1"),
      tab.hold("rec-1"),
    ]);

    expect([first, second]).toEqual(["held", "held"]);
    expect(tab.owns("rec-1")).toBe(true);
    expect(locks.held.size).toBe(1);
  });

  it("lets go of a claim released while it was still in flight", async () => {
    const tab = new LocalCopyOwnership();
    const claim = tab.hold("rec-1");
    tab.release();

    await expect(claim).resolves.toBe("busy");
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
    expect(tab.owns("rec-1")).toBe(false);
  });

  it("keeps a discarded copy locked until its upload and delete have settled", async () => {
    const tabA = new LocalCopyOwnership();
    await tabA.hold("rec-1");
    const upload = deferred<LocalUploadResult | void>();
    // The in-flight upload records its server row before the user discards.
    await updateRecordingBackupMeta("rec-1", { serverRecordingId: "srv-1" });

    const discarded = discardLocalRecording("rec-1", {
      afterUpload: upload.promise,
    });
    const released = tabA.releaseAfter(discarded);

    expect(tabA.owns("rec-1")).toBe(false);
    await expect(claimRecordingBackupLock("rec-1")).resolves.toEqual({
      status: "busy",
    });
    expect(await getRecordingBackupMeta("rec-1")).not.toBeNull();

    upload.resolve();
    await released;

    expect(await getRecordingBackupMeta("rec-1")).toBeNull();
    expect(callAction).toHaveBeenCalledWith("trash-recording", {
      id: "srv-1",
      skipIfReady: true,
    });
    const tabB = await claimRecordingBackupLock("rec-1");
    expect(tabB.status).toBe("held");
  });

  it("keeps the copy locked after a leave until the aborted upload settles", async () => {
    const tabA = new LocalCopyOwnership();
    await tabA.hold("rec-1");
    const upload = deferred();

    const released = tabA.releaseAfter(upload.promise);
    await expect(claimRecordingBackupLock("rec-1")).resolves.toEqual({
      status: "busy",
    });

    upload.resolve();
    await released;
    await expect(claimRecordingBackupLock("rec-1")).resolves.toMatchObject({
      status: "held",
    });
    expect(await getRecordingBackupMeta("rec-1")).not.toBeNull();
  });

  it("owns a copy without Web Locks only when this tab recorded it", async () => {
    vi.stubGlobal("navigator", {});
    const tab = new LocalCopyOwnership();

    await expect(tab.hold("rec-1")).resolves.toBe("unavailable");
    expect(tab.owns("rec-1")).toBe(false);
    tab.markRecordedHere("rec-1");
    expect(tab.owns("rec-1")).toBe(true);
  });
});
