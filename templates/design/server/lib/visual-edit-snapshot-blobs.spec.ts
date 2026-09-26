import { beforeEach, describe, expect, it, vi } from "vitest";

const deletePrivateBlob = vi.hoisted(() => vi.fn());
const cleanupQueue = vi.hoisted(() => {
  const rows = new Map<string, { blobHandle: string }>();
  const table = { blobHandle: "cleanup.blobHandle" };
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    limit: vi.fn(async () => [...rows.values()]),
  };
  const insertQuery = {
    values: vi.fn((values: { blobHandle: string }[]) => ({
      onConflictDoNothing: vi.fn(async () => {
        for (const row of values) rows.set(row.blobHandle, row);
      }),
    })),
  };
  const deleteQuery = {
    where: vi.fn(async (condition: { value: string }) => {
      rows.delete(condition.value);
    }),
  };
  const db = {
    insert: vi.fn(() => insertQuery),
    select: vi.fn(() => selectQuery),
    delete: vi.fn(() => deleteQuery),
  };
  return { rows, table, db };
});

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob,
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_column, value) => ({ value })),
}));
vi.mock("../db/index.js", () => ({
  getDb: () => cleanupQueue.db,
  schema: {
    designVisualEditSnapshotBlobCleanup: cleanupQueue.table,
  },
}));

import {
  deleteVisualEditSnapshotBlobs,
  parseVisualEditSnapshotBlobHandle,
} from "./visual-edit-snapshot-blobs.js";

const handle = {
  id: "snapshot-blob",
  provider: "private-provider",
  opaque: true,
  encrypted: true,
};

describe("visual-edit snapshot blob cleanup", () => {
  beforeEach(() => {
    cleanupQueue.rows.clear();
    deletePrivateBlob.mockReset();
    deletePrivateBlob.mockResolvedValue({ deleted: true });
  });

  it("parses an opaque private blob handle and rejects malformed stored values", () => {
    expect(parseVisualEditSnapshotBlobHandle(JSON.stringify(handle))).toEqual(
      handle,
    );
    expect(() => parseVisualEditSnapshotBlobHandle("not-json")).toThrow(
      /malformed/,
    );
    expect(() =>
      parseVisualEditSnapshotBlobHandle(
        JSON.stringify({ ...handle, opaque: false }),
      ),
    ).toThrow(/invalid/);
  });

  it("keeps failed deletions queued and retries them on the next cleanup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deletePrivateBlob.mockResolvedValueOnce({
      deleted: false,
      provider: "private-provider",
      reason: "unsupported",
    });

    await deleteVisualEditSnapshotBlobs([
      JSON.stringify(handle),
      JSON.stringify(handle),
      null,
    ]);

    expect(deletePrivateBlob).toHaveBeenCalledTimes(1);
    expect(deletePrivateBlob).toHaveBeenCalledWith(handle);
    expect(cleanupQueue.rows.has(JSON.stringify(handle))).toBe(true);
    expect(warn).toHaveBeenCalledOnce();

    await deleteVisualEditSnapshotBlobs([]);

    expect(deletePrivateBlob).toHaveBeenCalledTimes(2);
    expect(cleanupQueue.rows.has(JSON.stringify(handle))).toBe(false);
    warn.mockRestore();
  });
});
