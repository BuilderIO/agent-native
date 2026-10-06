import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const deletePrivateBlobMock = vi.hoisted(() => vi.fn());
const readPrivateBlobMock = vi.hoisted(() => vi.fn());
const finalizeReplayFrictionMock = vi.hoisted(() => vi.fn());

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
  readPrivateBlob: readPrivateBlobMock,
}));

vi.mock("./session-friction.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-friction.js")>()),
  finalizeReplayFriction: finalizeReplayFrictionMock,
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
            orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
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
    finalizeReplayFrictionMock.mockReset();
    finalizeReplayFrictionMock.mockResolvedValue(undefined);
    deletePrivateBlobMock.mockReset();
    readPrivateBlobMock.mockReset();
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
          sessionId: "session_1",
          ownerEmail: "owner@example.com",
          orgId: null,
          chunkCount: 3,
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
    expect(finalizeReplayFrictionMock).toHaveBeenCalledWith(
      {
        id: "rec_1",
        sessionId: "session_1",
        ownerEmail: "owner@example.com",
        orgId: null,
        chunkCount: 3,
        errorCount: 0,
        rageClickCount: 0,
      },
      "2026-01-01T01:00:00.000Z",
      expect.any(Function),
    );
  });

  it("leaves a recording active for the next sweep when its friction cannot be finalized", async () => {
    const { db, updates } = createDbMock([
      [
        {
          id: "rec_1",
          sessionId: "session_1",
          ownerEmail: "owner@example.com",
          orgId: "org_1",
          chunkCount: 3,
          status: "active",
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:20:00.000Z",
          lastIngestedAt: "2026-01-01T00:05:00.000Z",
          errorCount: 2,
          rageClickCount: 1,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);
    finalizeReplayFrictionMock.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await finalizeAbandonedSessionRecordings(
      new Date("2026-01-01T01:00:00.000Z"),
    );

    expect(finalizeReplayFrictionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec_1",
        errorCount: 2,
        rageClickCount: 1,
      }),
      "2026-01-01T01:00:00.000Z",
      expect.any(Function),
    );
    expect(result).toEqual({ finalized: 0 });
    expect(updates).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("stays active until the next sweep"),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("gives friction every stored chunk in order, a page at a time", async () => {
    const blobRef = (opaque: string) =>
      JSON.stringify({
        kind: "agent-native.session-replay.private-blob",
        version: 1,
        compression: "gzip",
        handle: { opaque },
      });
    const inline = Array.from({ length: 20 }, (_, seq) => ({
      seq,
      storageKind: "inline",
      inlineData: `{"events":[${seq}]}`,
    }));
    const { db } = createDbMock([
      [
        {
          id: "rec_1",
          sessionId: "session_1",
          ownerEmail: "owner@example.com",
          orgId: null,
          chunkCount: 23,
          status: "active",
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:20:00.000Z",
          lastIngestedAt: "2026-01-01T00:05:00.000Z",
        },
      ],
      inline,
      [
        { seq: 20, storageKind: "blob", storageRef: blobRef("readable") },
        { seq: 22, storageKind: "blob", storageRef: blobRef("missing") },
        { seq: 23, storageKind: "blob", storageRef: "not a ref" },
      ],
    ]);
    getDbMock.mockReturnValue(db);
    readPrivateBlobMock.mockImplementation(async (handle) => {
      if (handle.opaque !== "readable") throw new Error("blob missing");
      return { data: gzipSync('{"events":[20]}') };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await finalizeAbandonedSessionRecordings(
      new Date("2026-01-01T01:00:00.000Z"),
    );
    const readStoredChunks = finalizeReplayFrictionMock.mock.calls[0]?.[2];
    const chunks: unknown[] = [];
    for await (const chunk of readStoredChunks()) chunks.push(chunk);

    expect(chunks).toEqual([
      ...inline.map(({ seq, inlineData }) => ({ seq, inlineData })),
      { seq: 20, inlineData: '{"events":[20]}' },
      { seq: 22, inlineData: null },
      { seq: 23, inlineData: null },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not read a stored replay chunk"),
      expect.any(Error),
    );
    warn.mockRestore();
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
