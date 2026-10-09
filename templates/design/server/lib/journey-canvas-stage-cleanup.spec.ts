import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const deletePrivateBlob = vi.hoisted(() => vi.fn());
const ensureIndexExistsConcurrently = vi.hoisted(() => vi.fn());
const isLocalDatabase = vi.hoisted(() => vi.fn(() => false));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  ensureIndexExistsConcurrently,
  isLocalDatabase,
}));

vi.mock("@agent-native/core/private-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/private-blob")>()),
  deletePrivateBlob,
}));

import { closeDbExec, getDbExec } from "@agent-native/core/db";

import {
  ensureJourneyCanvasStageExpiryIndex,
  sweepExpiredJourneyCanvasStages,
} from "./journey-canvas-stage-cleanup.js";

const expiredAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString();
const recentAt = new Date().toISOString();
const privateHandle = (id: string) =>
  JSON.stringify({
    id,
    provider: "private-provider",
    opaque: true,
    encrypted: true,
  });

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  await getDbExec().execute(`CREATE TABLE design_board_replay_screenshots (
    id TEXT PRIMARY KEY,
    blob_handle TEXT NOT NULL,
    created_at TEXT
  )`);
  await getDbExec()
    .execute(`CREATE TABLE design_visual_edit_snapshot_blob_cleanup (
    blob_handle TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  ensureIndexExistsConcurrently.mockClear();
  isLocalDatabase.mockClear();
  deletePrivateBlob.mockReset().mockResolvedValue({ deleted: true });
});

describe("journey canvas staged frame cleanup", () => {
  it("requests concurrent index creation for non-local databases", async () => {
    await ensureJourneyCanvasStageExpiryIndex();

    expect(ensureIndexExistsConcurrently).toHaveBeenCalledWith(
      "design_board_replay_screenshots_stage_expiry_idx",
      expect.stringContaining("CREATE INDEX CONCURRENTLY"),
    );
    expect(ensureIndexExistsConcurrently).toHaveBeenCalledOnce();
  });

  it("skips the concurrent index on local databases", async () => {
    isLocalDatabase.mockReturnValueOnce(true);

    await ensureJourneyCanvasStageExpiryIndex();

    expect(ensureIndexExistsConcurrently).not.toHaveBeenCalled();
  });

  it("removes expired staging rows and only queues unreferenced private blobs", async () => {
    const expiredBlob = privateHandle("expired-stage");
    const sharedBlob = privateHandle("shared-stage");
    await getDbExec().execute({
      sql: `INSERT INTO design_board_replay_screenshots (id, blob_handle, created_at)
            VALUES ($1, $2, $3), ($4, $5, $3), ($6, $5, $3), ($7, $8, $9)`,
      args: [
        "jcu_expired",
        expiredBlob,
        expiredAt,
        "jcu_shared",
        sharedBlob,
        "jcs_shared",
        "jcu_recent",
        privateHandle("recent-stage"),
        recentAt,
      ],
    });
    deletePrivateBlob.mockResolvedValue({ deleted: true });

    const result = await sweepExpiredJourneyCanvasStages();

    expect(result).toEqual({
      rowsRemoved: 2,
      blobsQueued: 1,
      cleanupPending: false,
    });
    expect(deletePrivateBlob).toHaveBeenCalledOnce();
    expect(deletePrivateBlob).toHaveBeenCalledWith(JSON.parse(expiredBlob));
    const remaining = await getDbExec().execute({
      sql: `SELECT id FROM design_board_replay_screenshots ORDER BY id`,
    });
    expect(remaining.rows.map(({ id }) => id)).toEqual([
      "jcs_shared",
      "jcu_recent",
    ]);
  });

  it("continues through bounded batches until all expired rows are removed", async () => {
    const sharedBlob = privateHandle("many-expired-stages");
    const rowCount = 205;
    const values = Array.from({ length: rowCount }, (_, index) => {
      const base = index * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });
    const args = Array.from({ length: rowCount }, (_, index) => [
      `jcu_expired-many-${index}`,
      sharedBlob,
      expiredAt,
    ]).flat();
    await getDbExec().execute({
      sql: `INSERT INTO design_board_replay_screenshots (id, blob_handle, created_at)
            VALUES ${values.join(", ")}`,
      args,
    });

    const result = await sweepExpiredJourneyCanvasStages();

    expect(result).toEqual({
      rowsRemoved: rowCount,
      blobsQueued: 1,
      cleanupPending: false,
    });
    expect(deletePrivateBlob).toHaveBeenCalledOnce();
    const remaining = await getDbExec().execute({
      sql: "SELECT id FROM design_board_replay_screenshots WHERE id LIKE 'jcu_expired-many-%'",
    });
    expect(remaining.rows).toEqual([]);
  });

  it("reports remaining rows when the sweep deadline has elapsed", async () => {
    await getDbExec().execute({
      sql: `INSERT INTO design_board_replay_screenshots (id, blob_handle, created_at)
            VALUES ($1, $2, $3)`,
      args: [
        "jcu_expired-deadline",
        privateHandle("deadline-stage"),
        expiredAt,
      ],
    });

    const result = await sweepExpiredJourneyCanvasStages({
      deadlineAt: Date.now() - 1,
    });

    expect(result).toEqual({
      rowsRemoved: 0,
      blobsQueued: 0,
      cleanupPending: true,
    });
  });
});
