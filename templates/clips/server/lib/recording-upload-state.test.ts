import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn(),
  isPostgres: vi.fn(() => false),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: dbMock.execute }),
  isPostgres: () => dbMock.isPostgres(),
}));

import {
  deleteRecordingChunks,
  listRecordingChunkKeys,
  pruneStaleRecordingChunks,
  recordingChunkIndexFromKey,
  sumRecordingChunkBytes,
  validateRecordingChunkKeys,
} from "./recording-upload-state";

describe("recording upload state helpers", () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
    dbMock.isPostgres.mockReset();
    dbMock.isPostgres.mockReturnValue(false);
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
    ]);
  });

  it("sums chunk bytes in SQL instead of reading chunk payloads", async () => {
    dbMock.execute.mockResolvedValue({
      rows: [{ bytes: 7_340_032 }],
      rowsAffected: 0,
    });

    await expect(
      sumRecordingChunkBytes("owner@example.com", "rec-1"),
    ).resolves.toBe(7_340_032);

    const query = dbMock.execute.mock.calls[0]?.[0];
    expect(query.sql).toContain("SUM(json_extract(value, '$.bytes'))");
    expect(query.sql).not.toContain("SELECT key, value");
  });

  it("deletes all chunks for one recording by scoped prefix", async () => {
    dbMock.execute.mockResolvedValue({ rows: [], rowsAffected: 3 });

    await expect(
      deleteRecordingChunks("owner@example.com", "rec_1"),
    ).resolves.toBe(3);

    expect(dbMock.execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("DELETE FROM application_state"),
      args: ["owner@example.com", "recording-chunks-rec!_1-%"],
    });
  });

  it("prunes stale chunks without returning blob values", async () => {
    dbMock.execute
      .mockResolvedValueOnce({
        rows: [
          { key: "recording-chunks-rec_1-000000" },
          { key: "recording-chunks-rec_1-000001" },
        ],
        rowsAffected: 0,
      })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

    const purged = await pruneStaleRecordingChunks("owner@example.com", {
      now: Date.parse("2026-07-08T12:00:00.000Z"),
      ttlMs: 60_000,
      minIntervalMs: 0,
    });

    expect(purged).toBe(2);
    expect(dbMock.execute).toHaveBeenNthCalledWith(1, {
      sql: expect.stringContaining("SELECT key FROM application_state"),
      args: [
        "owner@example.com",
        "recording-chunks-%",
        "2026-07-08T11:59:00.000Z",
        100,
      ],
    });
    expect(String(dbMock.execute.mock.calls[0]?.[0]?.sql)).not.toContain(
      "data",
    );
  });

  it("uses the Postgres JSON aggregate when deployed on Postgres", async () => {
    dbMock.isPostgres.mockReturnValue(true);
    dbMock.execute.mockResolvedValue({
      rows: [{ bytes: "4194304" }],
      rowsAffected: 0,
    });

    await expect(
      sumRecordingChunkBytes("owner@example.com", "rec-1"),
    ).resolves.toBe(4_194_304);

    const query = dbMock.execute.mock.calls[0]?.[0];
    expect(query.sql).toContain("(value::jsonb ->> 'bytes')::bigint");
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
