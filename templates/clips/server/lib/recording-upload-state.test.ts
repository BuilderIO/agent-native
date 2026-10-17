import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: dbMock.execute }),
}));

import {
  deleteRecordingChunks,
  listRecordingChunkKeys,
  recordingChunkIndexFromKey,
  recordingUploadBrowserSessionId,
  recordingUploadStateForAttemptIfCurrent,
  recordingUploadStateForAttempt,
  sumRecordingChunkBytes,
  validateRecordingChunkKeys,
} from "./recording-upload-state";

describe("recording upload state helpers", () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
  });

  it("keeps upload attribution scoped to the matching attempt and generation", () => {
    const attempt = {
      recordingId: "rec_1",
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    };
    const state = {
      recordingId: "rec_1",
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
      browserSessionId: "browser-session-1",
    };

    expect(recordingUploadBrowserSessionId(state, attempt)).toBe(
      "browser-session-1",
    );
    expect(
      recordingUploadBrowserSessionId(state, {
        ...attempt,
        uploadGenerationId: "generation-2",
      }),
    ).toBeUndefined();
    expect(
      recordingUploadStateForAttempt({
        state,
        attempt: { ...attempt, uploadAttemptId: "attempt-2" },
        browserSessionId: "new-session",
      }),
    ).toEqual({
      recordingId: "rec_1",
      uploadAttemptId: "attempt-2",
      uploadGenerationId: "generation-1",
      browserSessionId: "new-session",
    });
  });

  it("preserves the first session for an attempt while enriching initial upload state", () => {
    const attempt = {
      recordingId: "rec_1",
      uploadAttemptId: "attempt-1",
      uploadGenerationId: "generation-1",
    };
    const initial = {
      recordingId: "rec_1",
      status: "uploading",
      progress: 0,
    };
    const attributed = recordingUploadStateForAttempt({
      state: initial,
      attempt,
      browserSessionId: "browser-session-1",
    });

    expect(attributed).toEqual({
      ...initial,
      ...attempt,
      browserSessionId: "browser-session-1",
    });
    expect(
      recordingUploadStateForAttempt({
        state: attributed,
        attempt,
        browserSessionId: "another-session",
      }),
    ).toEqual(attributed);
  });

  it("refuses to attribute a replacement upload state to a stale attempt", () => {
    expect(
      recordingUploadStateForAttemptIfCurrent({
        state: {
          recordingId: "rec_1",
          status: "uploading",
          uploadAttemptId: "attempt-2",
          uploadGenerationId: "generation-2",
          browserSessionId: "replacement-session",
        },
        attempt: {
          recordingId: "rec_1",
          uploadAttemptId: "attempt-1",
          uploadGenerationId: "generation-1",
        },
        browserSessionId: "stale-session",
      }),
    ).toBeNull();
  });

  it("lists chunk keys without selecting base64 chunk values", async () => {
    dbMock.execute.mockResolvedValue({
      rows: [
        { key: "recording-chunks-rec_1-000000" },
        { key: "recording-chunks-rec_1-000001" },
      ],
      rowsAffected: 0,
    });

    await expect(
      listRecordingChunkKeys("owner@example.com", "rec_1"),
    ).resolves.toEqual([
      "recording-chunks-rec_1-000000",
      "recording-chunks-rec_1-000001",
    ]);

    const query = dbMock.execute.mock.calls[0]?.[0];
    expect(query.sql).toContain("SELECT key FROM application_state");
    expect(query.sql).not.toContain("value");
    expect(query.args).toEqual([
      "owner@example.com",
      "recording-chunks-rec!_1-%",
      "recording-chunks-rec_1-".length + 6,
      "recording-chunks-rec_1-000000",
      "recording-chunks-rec_1-999999",
    ]);
  });

  it("sums exact legacy chunk bytes in SQL without reading chunk payloads", async () => {
    dbMock.execute.mockResolvedValue({
      rows: [{ bytes: 7_340_032 }],
      rowsAffected: 0,
    });

    await expect(
      sumRecordingChunkBytes("owner@example.com", "rec-1"),
    ).resolves.toBe(7_340_032);

    const query = dbMock.execute.mock.calls[0]?.[0];
    expect(query.sql).toContain("(value::jsonb ->> 'bytes')::bigint");
    expect(query.sql).toContain("length(key) = $3");
    expect(query.sql).not.toContain("SELECT key, value");
  });

  it("deletes exact legacy chunks without matching a fenced generation", async () => {
    dbMock.execute.mockResolvedValue({ rows: [], rowsAffected: 1 });

    await expect(
      deleteRecordingChunks("owner@example.com", "rec_1"),
    ).resolves.toBe(1);

    expect(dbMock.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("DELETE FROM application_state"),
      args: [
        "owner@example.com",
        "recording-chunks-rec!_1-%",
        "recording-chunks-rec_1-".length + 6,
        "recording-chunks-rec_1-000000",
        "recording-chunks-rec_1-999999",
      ],
    });
  });

  it("parses and sorts a complete contiguous chunk sequence", () => {
    expect(recordingChunkIndexFromKey("recording-chunks-rec-000012")).toBe(12);

    expect(
      validateRecordingChunkKeys(
        [
          "recording-chunks-rec-000002",
          "recording-chunks-rec-000000",
          "recording-chunks-rec-000001",
        ],
        3,
      ),
    ).toEqual([
      { key: "recording-chunks-rec-000000", index: 0 },
      { key: "recording-chunks-rec-000001", index: 1 },
      { key: "recording-chunks-rec-000002", index: 2 },
    ]);
  });

  it("rejects missing chunk indices before assembly", () => {
    expect(() =>
      validateRecordingChunkKeys([
        "recording-chunks-rec-000000",
        "recording-chunks-rec-000002",
      ]),
    ).toThrow("missing chunk 1");
  });

  it("rejects uploads that do not match the final expected chunk count", () => {
    expect(() =>
      validateRecordingChunkKeys(
        ["recording-chunks-rec-000000", "recording-chunks-rec-000001"],
        3,
      ),
    ).toThrow("2 of 3 chunks received");
  });

  it("rejects duplicate and malformed chunk metadata", () => {
    expect(() =>
      validateRecordingChunkKeys([
        "recording-chunks-rec-000000",
        "recording-chunks-rec-000000",
      ]),
    ).toThrow("duplicate chunk 0");

    expect(() =>
      validateRecordingChunkKeys(["recording-chunks-rec-final"]),
    ).toThrow("invalid chunk key");
  });
});
