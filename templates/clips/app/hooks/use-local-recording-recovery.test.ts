import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRecordingBackupMetas: vi.fn(),
  liveRecordingBackupIds: vi.fn(async () => new Set<string>()),
  deleteRecordingBackup: vi.fn(async () => {}),
  fetchServerUploadStatus: vi.fn(),
  trashStaleServerRecordings: vi.fn(async () => {}),
}));

vi.mock("@/lib/recording-backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recording-backup")>()),
  listRecordingBackupMetas: mocks.listRecordingBackupMetas,
  liveRecordingBackupIds: mocks.liveRecordingBackupIds,
  deleteRecordingBackup: mocks.deleteRecordingBackup,
}));
vi.mock("@/lib/local-recording-upload", () => ({
  fetchServerUploadStatus: mocks.fetchServerUploadStatus,
  trashStaleServerRecordings: mocks.trashStaleServerRecordings,
}));

import type { RecordingBackupMeta } from "@/lib/recording-backup";

import { findLocalRecordingsToFinish } from "./use-local-recording-recovery";

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
    ]);
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
});
