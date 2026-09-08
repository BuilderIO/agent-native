import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const deletePrivateBlobMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: getDbMock,
  };
});

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: deletePrivateBlobMock,
  putPrivateBlob: vi.fn(),
  readPrivateBlob: vi.fn(),
}));

import {
  expireOldSessionRecordings,
  finalizeAbandonedSessionRecordings,
} from "./session-replay";

function createDbMock(selectResults: unknown[][]) {
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const deletes: Array<{ table: unknown }> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = selectResults.shift() ?? [];
          return {
            limit: vi.fn(async () => rows),
            then: (resolve: (value: unknown[]) => void) =>
              Promise.resolve(rows).then(resolve),
          };
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async () => {
          updates.push({ table, values });
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        deletes.push({ table });
      }),
    })),
  };
  return { db, updates, deletes };
}

describe("session replay retention", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    deletePrivateBlobMock.mockReset();
    deletePrivateBlobMock.mockResolvedValue({
      deleted: true,
      provider: "test",
    });
  });

  it("finalizes stale active recordings as completed", async () => {
    const { db, updates } = createDbMock([
      [
        {
          id: "rec_1",
          status: "active",
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:20:00.000Z",
          lastIngestedAt: "2026-01-01T00:05:00.000Z",
          durationMs: null,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    const result = await finalizeAbandonedSessionRecordings(
      new Date("2026-01-01T01:00:00.000Z"),
    );

    expect(result).toEqual({ finalized: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      values: {
        status: "completed",
        endedAt: "2026-01-01T00:05:00.000Z",
        durationMs: 5 * 60 * 1000,
        updatedAt: "2026-01-01T01:00:00.000Z",
      },
    });
  });

  it("expires old recordings after deleting private blob chunks", async () => {
    const storageRef = JSON.stringify({
      kind: "agent-native.session-replay.private-blob",
      version: 1,
      compression: "gzip",
      handle: {
        id: "blob_1",
        provider: "test",
        opaque: true,
      },
    });
    const { db, deletes } = createDbMock([
      [{ id: "rec_1" }],
      [
        {
          id: "chunk_1",
          recordingId: "rec_1",
          storageKind: "blob",
          storageRef,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    const result = await expireOldSessionRecordings(
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(result).toEqual({
      expired: 1,
      chunks: 1,
      blobDeleteFailures: 0,
    });
    expect(deletePrivateBlobMock).toHaveBeenCalledWith({
      id: "blob_1",
      provider: "test",
      opaque: true,
    });
    expect(deletes).toHaveLength(4);
  });

  it("keeps SQL rows when private blob deletion reports no deletion", async () => {
    deletePrivateBlobMock.mockResolvedValue({
      deleted: false,
      provider: "test",
    });
    const storageRef = JSON.stringify({
      kind: "agent-native.session-replay.private-blob",
      version: 1,
      compression: "gzip",
      handle: {
        id: "blob_1",
        provider: "test",
        opaque: true,
      },
    });
    const { db, deletes } = createDbMock([
      [{ id: "rec_1" }],
      [
        {
          id: "chunk_1",
          recordingId: "rec_1",
          storageKind: "blob",
          storageRef,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    const result = await expireOldSessionRecordings(
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(result).toEqual({
      expired: 0,
      chunks: 0,
      blobDeleteFailures: 1,
    });
    expect(deletes).toHaveLength(0);
  });
});
