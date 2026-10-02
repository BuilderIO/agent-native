import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRecordingBackupMetas: vi.fn(),
  liveRecordingBackupIds: vi.fn(async () => new Set<string>()),
  deleteRecordingBackup: vi.fn(async () => {}),
  fetchServerUploadStatus: vi.fn(),
  trashStaleServerRecordings: vi.fn(async () => {}),
  claimRecordingBackupOwner: vi.fn(
    async (recordingId: string, ownerEmail: string) =>
      ({ recordingId, ownerEmail }) as unknown,
  ),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { warning: mocks.toastWarning, info: mocks.toastInfo },
}));

vi.mock("@/lib/recording-backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recording-backup")>()),
  listRecordingBackupMetas: mocks.listRecordingBackupMetas,
  liveRecordingBackupIds: mocks.liveRecordingBackupIds,
  deleteRecordingBackup: mocks.deleteRecordingBackup,
  claimRecordingBackupOwner: mocks.claimRecordingBackupOwner,
}));
vi.mock("@/lib/local-recording-upload", () => ({
  fetchServerUploadStatus: mocks.fetchServerUploadStatus,
  trashStaleServerRecordings: mocks.trashStaleServerRecordings,
}));

import type { RecordingBackupMeta } from "@/lib/recording-backup";

import {
  findLocalRecordingsToFinish,
  offerLocalRecording,
} from "./use-local-recording-recovery";

function meta(
  recordingId: string,
  overrides: Partial<RecordingBackupMeta> = {},
): RecordingBackupMeta {
  return {
    recordingId,
    mimeType: "video/webm",
    durationMs: 1_000,
    width: 1,
    height: 1,
    hasAudio: true,
    hasCamera: false,
    bytes: 10,
    chunkCount: 1,
    savedAt: "2026-10-01T10:00:00.000Z",
    completedAt: null,
    ownerEmail: "me@example.com",
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

describe("findLocalRecordingsToFinish", () => {
  it("offers unfinished copies and cleans up the ones the server already has", async () => {
    mocks.listRecordingBackupMetas.mockResolvedValue([
      meta("never-uploaded", { localOnly: true }),
      meta("uploaded-and-ready", {
        serverRecordingId: "srv-ready",
        staleServerRecordingIds: ["srv-old"],
      }),
      meta("still-processing", { serverRecordingId: "srv-processing" }),
      meta("interrupted", { serverRecordingId: "srv-failed" }),
      meta("other-account", { ownerEmail: "someone@example.com" }),
      meta("legacy-unknown-row", { ownerEmail: null }),
    ]);
    mocks.fetchServerUploadStatus.mockImplementation(async (id: string) => {
      if (id === "srv-ready") return { found: true, status: "ready" };
      if (id === "srv-processing") return { found: true, status: "processing" };
      if (id === "srv-failed") return { found: true, status: "failed" };
      return { found: false };
    });

    const pending = await findLocalRecordingsToFinish("me@example.com");

    expect(pending.map((m) => m.recordingId)).toEqual([
      "never-uploaded",
      "interrupted",
      "legacy-unknown-row",
    ]);
    expect(pending[pending.length - 1]?.ownerEmail).toBeNull();
    expect(mocks.claimRecordingBackupOwner).not.toHaveBeenCalled();
    expect(mocks.trashStaleServerRecordings).toHaveBeenCalledWith(["srv-old"]);
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledWith(
      "uploaded-and-ready",
    );
    expect(mocks.deleteRecordingBackup).toHaveBeenCalledTimes(1);
  });

  it("still offers a copy when the server can't be reached", async () => {
    mocks.listRecordingBackupMetas.mockResolvedValue([
      meta("offline", { serverRecordingId: "srv-1" }),
    ]);
    mocks.fetchServerUploadStatus.mockRejectedValue(new TypeError("offline"));

    const pending = await findLocalRecordingsToFinish("me@example.com");

    expect(pending.map((m) => m.recordingId)).toEqual(["offline"]);
    expect(mocks.deleteRecordingBackup).not.toHaveBeenCalled();
  });

  it("stamps an ownerless copy whose server row this account can read", async () => {
    mocks.listRecordingBackupMetas.mockResolvedValue([
      meta("ownerless-mine", { ownerEmail: null, serverRecordingId: "srv-1" }),
    ]);
    mocks.fetchServerUploadStatus.mockResolvedValue({
      found: true,
      status: "failed",
    });

    const pending = await findLocalRecordingsToFinish("me@example.com");

    expect(mocks.claimRecordingBackupOwner).toHaveBeenCalledWith(
      "ownerless-mine",
      "me@example.com",
    );
    expect(pending).toEqual([
      { recordingId: "ownerless-mine", ownerEmail: "me@example.com" },
    ]);
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
    mocks.liveRecordingBackupIds.mockResolvedValueOnce(new Set(["rec-1"]));
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
