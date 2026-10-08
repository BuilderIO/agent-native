import { beforeEach, describe, expect, it, vi } from "vitest";

const deletePrivateBlob = vi.hoisted(() => vi.fn());
const cleanupQueue = vi.hoisted(() => {
  const rows = new Map<string, { blobHandle: string }>();
  const table = { blobHandle: "cleanup.blobHandle" };
  const selectQuery = {
    filter: null as string[] | null,
    excluded: null as string[] | null,
    from: vi.fn(() => {
      selectQuery.filter = null;
      selectQuery.excluded = null;
      return selectQuery;
    }),
    where: vi.fn((condition: { values?: string[]; excluded?: string[] }) => {
      selectQuery.filter = condition.values ?? null;
      selectQuery.excluded = condition.excluded ?? null;
      return selectQuery;
    }),
    limit: vi.fn(async (limit = 50) =>
      [...rows.values()]
        .filter(
          ({ blobHandle }) =>
            (!selectQuery.filter || selectQuery.filter.includes(blobHandle)) &&
            (!selectQuery.excluded ||
              !selectQuery.excluded.includes(blobHandle)),
        )
        .slice(0, limit),
    ),
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
  inArray: vi.fn((_column, values) => ({ values })),
  notInArray: vi.fn((_column, values) => ({ excluded: values })),
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

    await expect(
      deleteVisualEditSnapshotBlobs([
        JSON.stringify(handle),
        JSON.stringify(handle),
        null,
      ]),
    ).resolves.toBe(true);

    expect(deletePrivateBlob).toHaveBeenCalledTimes(1);
    expect(deletePrivateBlob).toHaveBeenCalledWith(handle);
    expect(cleanupQueue.rows.has(JSON.stringify(handle))).toBe(true);
    expect(warn).toHaveBeenCalledOnce();

    await expect(deleteVisualEditSnapshotBlobs([])).resolves.toBe(false);

    expect(deletePrivateBlob).toHaveBeenCalledTimes(2);
    expect(cleanupQueue.rows.has(JSON.stringify(handle))).toBe(false);
    warn.mockRestore();
  });

  it("prioritizes newly queued handles before older failed deletions", async () => {
    const oldHandles = Array.from({ length: 50 }, (_, index) =>
      JSON.stringify({ ...handle, id: `old-snapshot-${index}` }),
    );
    for (const blobHandle of oldHandles) {
      cleanupQueue.rows.set(blobHandle, { blobHandle });
    }
    const newHandle = JSON.stringify({ ...handle, id: "new-screenshot" });
    const attempted: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deletePrivateBlob.mockImplementation(async (value: typeof handle) => {
      attempted.push(value.id);
      return value.id === "new-screenshot"
        ? { deleted: true }
        : {
            deleted: false,
            provider: "private-provider",
            reason: "provider unavailable",
          };
    });

    try {
      await expect(deleteVisualEditSnapshotBlobs([newHandle])).resolves.toBe(
        false,
      );

      expect(attempted[0]).toBe("new-screenshot");
      expect(attempted).toHaveLength(50);
      expect(cleanupQueue.rows.has(newHandle)).toBe(false);
      expect(cleanupQueue.rows.size).toBe(50);
    } finally {
      warn.mockRestore();
    }
  });
});
