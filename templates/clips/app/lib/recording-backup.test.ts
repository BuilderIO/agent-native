import { describe, expect, it } from "vitest";

import {
  nextLocalRecordingState,
  recoverableBackupChunks,
  selectRecoverableRecordingBackups,
  type RecordingBackupChunk,
  type RecordingBackupMeta,
} from "./recording-backup";

function meta(
  overrides: Partial<RecordingBackupMeta> = {},
): RecordingBackupMeta {
  return {
    recordingId: "local-1",
    mimeType: "video/webm",
    durationMs: 3_000,
    width: 1280,
    height: 720,
    hasAudio: true,
    hasCamera: false,
    bytes: 6,
    chunkCount: 3,
    savedAt: "2026-10-01T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function chunk(index: number, contents = "ab"): RecordingBackupChunk {
  const blob = new Blob([contents]);
  return {
    recordingId: "local-1",
    index,
    blob,
    bytes: blob.size,
    createdAt: "2026-10-01T10:00:00.000Z",
  };
}

describe("local recording state machine", () => {
  it("walks recording → recorded-local → uploading → uploaded → processed", () => {
    expect(nextLocalRecordingState("recording", "stop")).toBe("recorded-local");
    expect(nextLocalRecordingState("recorded-local", "upload")).toBe(
      "uploading",
    );
    expect(nextLocalRecordingState("uploading", "accepted")).toBe("uploaded");
    expect(nextLocalRecordingState("uploaded", "processed")).toBe("processed");
  });

  it("returns a failed or interrupted upload to the local copy", () => {
    expect(nextLocalRecordingState("uploading", "failed")).toBe(
      "recorded-local",
    );
    expect(nextLocalRecordingState("uploading", "interrupt")).toBe(
      "recorded-local",
    );
    expect(nextLocalRecordingState("uploaded", "failed")).toBe(
      "recorded-local",
    );
    expect(nextLocalRecordingState("recording", "interrupt")).toBe(
      "recorded-local",
    );
  });

  it("refuses transitions that would skip server confirmation", () => {
    expect(() => nextLocalRecordingState("recording", "processed")).toThrow(
      /cannot processed while recording/,
    );
    expect(() =>
      nextLocalRecordingState("recorded-local", "processed"),
    ).toThrow();
    expect(() => nextLocalRecordingState("recording", "upload")).toThrow();
  });
});

describe("recoverableBackupChunks", () => {
  it("requires a finished copy to be whole", () => {
    const finished = meta({ completedAt: "2026-10-01T10:01:00.000Z" });
    expect(
      recoverableBackupChunks(finished, [chunk(0), chunk(1), chunk(2)]),
    ).toHaveLength(3);
    expect(recoverableBackupChunks(finished, [chunk(0), chunk(2)])).toBeNull();
  });

  it("recovers the contiguous prefix of a copy cut off mid-recording", () => {
    // The meta lags one chunk behind when a tab dies between the two writes.
    const cutOff = meta({ chunkCount: 1, bytes: 2 });
    expect(
      recoverableBackupChunks(cutOff, [chunk(0), chunk(1), chunk(3)])?.map(
        (c) => c.index,
      ),
    ).toEqual([0, 1]);
  });

  it("has nothing to recover without the header chunk", () => {
    expect(recoverableBackupChunks(meta(), [chunk(1), chunk(2)])).toBeNull();
    expect(recoverableBackupChunks(meta(), [])).toBeNull();
  });
});

describe("selectRecoverableRecordingBackups", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");

  it("offers this account's copies and ownerless ones to claim, never another account's", () => {
    const picked = selectRecoverableRecordingBackups(
      [
        meta({ recordingId: "mine", ownerEmail: "Me@Example.com" }),
        meta({ recordingId: "live", ownerEmail: "me@example.com" }),
        meta({ recordingId: "theirs", ownerEmail: "other@example.com" }),
        meta({ recordingId: "anonymous-local", localOnly: true }),
        meta({ recordingId: "legacy-server-backed" }),
        meta({
          recordingId: "empty",
          ownerEmail: "me@example.com",
          bytes: 0,
          chunkCount: 0,
        }),
      ],
      { liveIds: new Set(["live"]), ownerEmail: "me@example.com", nowMs: now },
    );
    expect(picked.map((m) => m.recordingId)).toEqual([
      "mine",
      "anonymous-local",
      "legacy-server-backed",
    ]);
  });

  it("treats a recently written copy as live when Web Locks are unavailable", () => {
    const picked = selectRecoverableRecordingBackups(
      [
        meta({
          recordingId: "fresh",
          ownerEmail: "me@example.com",
          savedAt: new Date(now - 5_000).toISOString(),
        }),
        meta({
          recordingId: "stale",
          ownerEmail: "me@example.com",
          savedAt: new Date(now - 120_000).toISOString(),
        }),
      ],
      { liveIds: null, ownerEmail: "me@example.com", nowMs: now },
    );
    expect(picked.map((m) => m.recordingId)).toEqual(["stale"]);
  });

  it("lists the newest copy first", () => {
    const picked = selectRecoverableRecordingBackups(
      [
        meta({
          recordingId: "old",
          ownerEmail: "me@example.com",
          savedAt: "2026-10-01T09:00:00.000Z",
        }),
        meta({
          recordingId: "new",
          ownerEmail: "me@example.com",
          savedAt: "2026-10-01T11:00:00.000Z",
        }),
      ],
      { liveIds: new Set(), ownerEmail: "me@example.com", nowMs: now },
    );
    expect(picked.map((m) => m.recordingId)).toEqual(["new", "old"]);
  });
});
