import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchServerUploadStatus: vi.fn(),
  trashStaleServerRecordings: vi.fn(async () => {}),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { warning: mocks.toastWarning, info: mocks.toastInfo },
}));
vi.mock("@/lib/local-recording-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/local-recording-upload")>()),
  fetchServerUploadStatus: mocks.fetchServerUploadStatus,
  trashStaleServerRecordings: mocks.trashStaleServerRecordings,
}));

import {
  claimRecordingBackupLock,
  getRecordingBackupMeta,
  putRecordingBackupChunk,
  putRecordingBackupMeta,
  type RecordingBackupMeta,
} from "@/lib/recording-backup";
import { FakeLockManager } from "@/lib/testing/fake-lock-manager";

import {
  findLocalRecordingsToFinish,
  offerLocalRecording,
  remindLaterAboutLocalRecording,
  watchLocalRecordings,
} from "./use-local-recording-recovery";

function meta(
  recordingId: string,
  overrides: Partial<RecordingBackupMeta> = {},
): RecordingBackupMeta {
  return {
    recordingId,
    mimeType: "video/webm",
    durationMs: 4_000,
    width: 1,
    height: 1,
    hasAudio: true,
    hasCamera: false,
    bytes: 4,
    chunkCount: 2,
    savedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:04.000Z",
    ownerEmail: "me@example.com",
    ...overrides,
  };
}

async function saveCopy(m: RecordingBackupMeta) {
  await putRecordingBackupChunk(m.recordingId, 0, new Blob(["ab"]));
  await putRecordingBackupChunk(m.recordingId, 1, new Blob(["cd"]));
  await putRecordingBackupMeta(m);
}

function ready(sourceSizeBytes: number | null, durationMs = 4_000) {
  return {
    found: true,
    status: "ready",
    verificationPending: false,
    sourceSizeBytes,
    durationMs,
  };
}

let locks: FakeLockManager;

beforeEach(() => {
  locks = new FakeLockManager();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("navigator", { locks });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("local copy ownership across tabs", () => {
  it("resolves a claim only once the lock is granted", async () => {
    const claim = claimRecordingBackupLock("rec-1");
    expect(locks.held.size).toBe(0);
    await expect(claim).resolves.toMatchObject({ status: "held" });
    expect(locks.held.has("clips-local-recording:rec-1")).toBe(true);
  });

  it("never lets a second tab see or take a copy the recording tab holds", async () => {
    const recordingTab = await claimRecordingBackupLock("live");
    await saveCopy(meta("live", { completedAt: null, state: "recording" }));

    const scan = await findLocalRecordingsToFinish("me@example.com");
    expect(scan.pending).toEqual([]);
    await expect(claimRecordingBackupLock("live")).resolves.toEqual({
      status: "busy",
    });

    if (recordingTab.status === "held") recordingTab.release();
    await vi.waitFor(() => expect(locks.held.size).toBe(0));
    const after = await findLocalRecordingsToFinish("me@example.com");
    expect(after.pending.map((m) => m.recordingId)).toEqual(["live"]);
  });

  it("refuses ownership without Web Locks instead of assuming it", async () => {
    vi.stubGlobal("navigator", {});
    await expect(claimRecordingBackupLock("rec-1")).resolves.toEqual({
      status: "unavailable",
    });
  });
});

describe("findLocalRecordingsToFinish", () => {
  it("deletes a copy only when the server proves it holds every byte", async () => {
    await saveCopy(meta("proven", { serverRecordingId: "srv-1" }));
    await saveCopy(meta("short", { serverRecordingId: "srv-2" }));
    await saveCopy(meta("no-proof", { serverRecordingId: "srv-3" }));
    mocks.fetchServerUploadStatus.mockImplementation(async (id: string) =>
      id === "srv-1" ? ready(4) : id === "srv-2" ? ready(2) : ready(null),
    );

    const scan = await findLocalRecordingsToFinish("me@example.com");

    expect(await getRecordingBackupMeta("proven")).toBeNull();
    expect(scan.pending.map((m) => m.recordingId).sort()).toEqual([
      "no-proof",
      "short",
    ]);
  });

  it("keeps a proven copy visible, and rechecks it, when another tab holds it", async () => {
    await saveCopy(meta("proven", { serverRecordingId: "srv-1" }));
    mocks.fetchServerUploadStatus.mockImplementation(async () => {
      // Another tab takes the copy while this status request is in flight.
      await claimRecordingBackupLock("proven");
      return ready(4);
    });

    const scan = await findLocalRecordingsToFinish("me@example.com");

    expect(await getRecordingBackupMeta("proven")).not.toBeNull();
    expect(scan.pending.map((m) => m.recordingId)).toEqual(["proven"]);
    expect(scan.waitingOnServer).toBe(1);
  });

  it("keeps a proven copy visible when the browser has no Web Locks", async () => {
    vi.stubGlobal("navigator", {});
    await saveCopy(meta("proven", { serverRecordingId: "srv-1" }));
    mocks.fetchServerUploadStatus.mockResolvedValue(ready(4));

    const scan = await findLocalRecordingsToFinish("me@example.com");

    expect(await getRecordingBackupMeta("proven")).not.toBeNull();
    expect(scan.pending.map((m) => m.recordingId)).toEqual(["proven"]);
    expect(scan.waitingOnServer).toBe(0);
  });

  it("keeps a copy that was cut short even when the server matches it", async () => {
    await saveCopy(
      meta("cut-short", { serverRecordingId: "srv-1", incomplete: true }),
    );
    mocks.fetchServerUploadStatus.mockResolvedValue(ready(4));

    const scan = await findLocalRecordingsToFinish("me@example.com");

    expect(await getRecordingBackupMeta("cut-short")).not.toBeNull();
    expect(scan.pending.map((m) => m.recordingId)).toEqual(["cut-short"]);
  });

  it("still offers a copy whose check fails instead of hiding the rest", async () => {
    await saveCopy(
      meta("broken", { ownerEmail: null, serverRecordingId: "s1" }),
    );
    await saveCopy(meta("fine", { localOnly: true }));
    mocks.fetchServerUploadStatus.mockResolvedValue({
      found: true,
      status: "failed",
      verificationPending: false,
      sourceSizeBytes: null,
      durationMs: null,
    });
    vi.stubGlobal("navigator", {
      locks: {
        query: async () => ({ held: [], pending: [] }),
      },
    });
    // The owner stamp needs IndexedDB writes; break them for this copy only.
    const original = IDBFactory.prototype.open;
    let opens = 0;
    vi.spyOn(IDBFactory.prototype, "open").mockImplementation(function (
      this: IDBFactory,
      ...args: Parameters<IDBFactory["open"]>
    ) {
      opens += 1;
      // 1: the scan's list read; 2: stamping the ownerless copy.
      if (opens === 2) throw new Error("disk read failed");
      return original.apply(this, args);
    });

    const scan = await findLocalRecordingsToFinish("me@example.com");

    expect(scan.pending.map((m) => m.recordingId).sort()).toEqual([
      "broken",
      "fine",
    ]);
  });

  it("re-verifies a copy kept after an unproven upload, never a cut-short one", async () => {
    await saveCopy(
      meta("kept", {
        serverRecordingId: "srv-1",
        state: "uploaded",
        keptAfterUpload: "unverified",
      }),
    );
    await saveCopy(
      meta("partial", {
        serverRecordingId: "srv-2",
        state: "uploaded",
        keptAfterUpload: "partial",
      }),
    );
    mocks.fetchServerUploadStatus.mockResolvedValue(ready(4));

    const scan = await findLocalRecordingsToFinish("me@example.com");

    expect(await getRecordingBackupMeta("kept")).toBeNull();
    expect(await getRecordingBackupMeta("partial")).not.toBeNull();
    expect(scan.pending.map((m) => m.recordingId)).toEqual(["partial"]);
  });

  it("offers a copy whose upload has processed too long instead of waiting forever", async () => {
    const processing = {
      found: true,
      status: "processing",
      verificationPending: true,
      sourceSizeBytes: null,
      durationMs: null,
    };
    const now = Date.parse("2026-10-01T12:00:00.000Z");
    await saveCopy(
      meta("fresh", {
        serverRecordingId: "srv-1",
        uploadedAt: "2026-10-01T11:30:00.000Z",
      }),
    );
    await saveCopy(
      meta("stuck", {
        serverRecordingId: "srv-2",
        uploadedAt: "2026-10-01T10:30:00.000Z",
      }),
    );
    mocks.fetchServerUploadStatus.mockResolvedValue(processing);

    const scan = await findLocalRecordingsToFinish("me@example.com", now);

    expect(scan.waitingOnServer).toBe(1);
    expect(scan.pending.map((m) => m.recordingId)).toEqual(["stuck"]);
  });

  it("stops offering a snoozed copy until tomorrow, and keeps it", async () => {
    const now = Date.parse("2026-10-01T12:00:00.000Z");
    await saveCopy(meta("snoozed", { localOnly: true }));
    await remindLaterAboutLocalRecording("snoozed", now);

    const today = await findLocalRecordingsToFinish("me@example.com", now);
    const tomorrow = await findLocalRecordingsToFinish(
      "me@example.com",
      now + 25 * 60 * 60_000,
    );

    expect(today.pending).toEqual([]);
    expect(await getRecordingBackupMeta("snoozed")).not.toBeNull();
    expect(tomorrow.pending.map((m) => m.recordingId)).toEqual(["snoozed"]);
  });
});

describe("watchLocalRecordings", () => {
  it("rechecks a processing copy and deletes it only after a proven ready", async () => {
    await saveCopy(
      meta("processing", {
        serverRecordingId: "srv-1",
        uploadedAt: new Date().toISOString(),
      }),
    );
    mocks.fetchServerUploadStatus
      .mockResolvedValueOnce({
        found: true,
        status: "processing",
        verificationPending: true,
        sourceSizeBytes: null,
        durationMs: null,
      })
      .mockResolvedValue(ready(4));
    const results: number[] = [];

    const stop = watchLocalRecordings(
      "me@example.com",
      {
        onResult: (scan) => results.push(scan.waitingOnServer),
        onError: () => {},
      },
      [20],
    );

    await vi.waitFor(() => expect(results).toEqual([1, 0]));
    expect(await getRecordingBackupMeta("processing")).toBeNull();
    expect(mocks.fetchServerUploadStatus).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports an unreadable store as an error, never as nothing to recover", async () => {
    vi.spyOn(IDBFactory.prototype, "open").mockImplementation(() => {
      throw new Error("blocked");
    });
    const onError = vi.fn();
    const onResult = vi.fn();

    const stop = watchLocalRecordings("me@example.com", { onResult, onError });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onResult).not.toHaveBeenCalled();
    expect(typeof onError.mock.calls[0]![1]).toBe("function");
    stop();
  });
});

describe("offerLocalRecording", () => {
  const t = (key: string) => key;

  function clickOffer(
    onFinish = vi.fn(),
    ownerEmail: string | null = "me@example.com",
  ) {
    const navigate = vi.fn();
    offerLocalRecording({
      meta: { recordingId: "rec-1", ownerEmail },
      t: t as never,
      navigate,
      onFinish,
    });
    const options = mocks.toastWarning.mock.lastCall![1] as {
      action: { onClick: () => void };
    };
    options.action.onClick();
    return { navigate, onFinish };
  }

  it("re-checks the copy's lock at click time before finishing in place", async () => {
    await claimRecordingBackupLock("rec-1");
    const { onFinish, navigate } = clickOffer();
    await vi.waitFor(() =>
      expect(mocks.toastInfo).toHaveBeenCalledWith(
        "recordRoute.localRecordingOpenElsewhere",
      ),
    );
    expect(onFinish).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("finishes in place once no other tab holds the copy", async () => {
    const { onFinish } = clickOffer();
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledWith("rec-1"));
  });

  it("lets the user snooze the prompt without touching the copy", async () => {
    await saveCopy(meta("rec-1", { localOnly: true }));
    clickOffer();
    const options = mocks.toastWarning.mock.lastCall![1] as {
      cancel: { label: string; onClick: () => void };
    };
    expect(options.cancel.label).toBe("recordRoute.remindTomorrow");

    options.cancel.onClick();

    await vi.waitFor(async () =>
      expect((await getRecordingBackupMeta("rec-1"))?.remindAfter).toEqual(
        expect.any(String),
      ),
    );
  });

  it("sends an ownerless copy to the explicit claim step, never straight to upload", async () => {
    const { onFinish, navigate } = clickOffer(vi.fn(), null);
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/record?localRecording=rec-1"),
    );
    expect(onFinish).not.toHaveBeenCalled();
    expect(mocks.toastWarning.mock.lastCall![0]).toBe(
      "recordRoute.unclaimedRecording",
    );
  });
});
