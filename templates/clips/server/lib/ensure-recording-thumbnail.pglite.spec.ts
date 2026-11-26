// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { and, eq, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../db/schema.js";

const mocks = vi.hoisted(() => ({
  loadRecordingMediaBytes: vi.fn(),
  uploadRecordingMedia: vi.fn(),
  deleteUploadedFile: vi.fn(),
  recordingEmbedProvider: vi.fn(),
}));

vi.mock("../db/index.js", async () => {
  const { createGetDb } = await import("@agent-native/core/db");
  const tables = await import("../db/schema.js");
  return { getDb: createGetDb(tables), schema: tables };
});
vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (column: unknown, email: string) =>
    sql`lower(${column as never}) = ${email.toLowerCase()}`,
}));
vi.mock("../../shared/embed-provider.js", () => ({
  recordingEmbedProvider: (...args: unknown[]) =>
    mocks.recordingEmbedProvider(...args),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: (...args: unknown[]) => mocks.deleteUploadedFile(...args),
}));
vi.mock("./public-agent-context.js", () => ({
  loadRecordingMediaBytes: (...args: unknown[]) =>
    mocks.loadRecordingMediaBytes(...args),
}));
vi.mock("./upload-recording-media.js", () => ({
  uploadRecordingMedia: (...args: unknown[]) =>
    mocks.uploadRecordingMedia(...args),
}));
vi.mock("./recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: async () => true,
}));
vi.mock("./video-frame.js", () => ({
  extractJpegFrame: async () => new Uint8Array([1, 2, 3]),
  VideoFrameExtractionError: class VideoFrameExtractionError extends Error {},
}));

const { getDb } = await import("../db/index.js");
const { ensureRecordingThumbnail, markThumbnailFailed } =
  await import("./ensure-recording-thumbnail.js");
const { claimLease, writeUnderLease } = await import("./recording-leases.js");
const { compareAndSetAppState, readAppState } =
  await import("@agent-native/core/application-state");

const OWNER = "owner@example.com";
const LEASE_KEY = "recording-thumbnail:rec-1";
const LEASE_MS = 5 * 60 * 1000;
const TAKER_URL = "https://cdn.example.com/taker-thumb.jpg";
const STALE_URL = "https://cdn.example.com/stale-thumb.jpg";
const OLD_URL = "https://cdn.example.com/old-thumb.jpg";
const ASSET_KEY = "recording-thumbnail-asset-rec-1";
const START = new Date("2026-01-01T00:00:00.000Z").getTime();

function createTable(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map(
    (column) =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`,
  );
  // raw-sql-ok: test DDL built from the Drizzle schema's own column names.
  return `CREATE TABLE "${config.name}" (${columns.join(", ")})`;
}

async function takeOver(write: boolean) {
  vi.setSystemTime(Date.now() + LEASE_MS + 1_000);
  const lease = await claimLease(LEASE_KEY, LEASE_MS);
  if (!lease) throw new Error("expected the expired lease to be free");
  if (!write) return lease;
  await writeUnderLease(lease, (held) =>
    getDb()
      .update(schema.recordings)
      .set({
        thumbnailUrl: TAKER_URL,
        thumbnailStatus: "generated",
        thumbnailFailureReason: null,
      })
      .where(and(eq(schema.recordings.id, "rec-1"), held))
      .returning({ id: schema.recordings.id }),
  );
  return lease;
}

async function thumbnail() {
  const rows = await getDb()
    .select({
      url: schema.recordings.thumbnailUrl,
      status: schema.recordings.thumbnailStatus,
      reason: schema.recordings.thumbnailFailureReason,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, "rec-1"));
  if (rows.length !== 1) throw new Error("expected the recording row");
  return rows[0];
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.stubEnv("AGENT_USER_EMAIL", OWNER);
  await getDbExec().execute(createTable(schema.recordings));
  await readAppState(ASSET_KEY);
  await getDbExec().execute(
    `CREATE TABLE clips_backfill_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
  );
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  await getDbExec().execute("DELETE FROM clips_backfill_leases");
  await getDbExec().execute("DELETE FROM recordings");
  await getDbExec().execute("DELETE FROM application_state");
  await getDbExec().execute({
    sql: `INSERT INTO recordings
      (id, owner_email, status, video_url, video_format, edits_json)
      VALUES ('rec-1', ?, 'ready', 'https://cdn.example.com/video.webm', 'webm', '{}')`,
    args: [OWNER],
  });
  mocks.deleteUploadedFile.mockResolvedValue(true);
  mocks.recordingEmbedProvider.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("a thumbnail worker whose lease expired (SC-05)", () => {
  it("can't mark the thumbnail missing over the one its successor generated", async () => {
    mocks.loadRecordingMediaBytes.mockImplementation(async () => {
      await takeOver(true);
      return { bytes: new Uint8Array(), mimeType: "video/webm" };
    });

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: OWNER,
    });

    expect(result).toMatchObject({ status: "skipped-lease", changed: false });
    expect(await thumbnail()).toEqual({
      url: TAKER_URL,
      status: "generated",
      reason: null,
    });
  });

  it("can't save its thumbnail after its successor took the recording, and deletes its upload", async () => {
    mocks.uploadRecordingMedia.mockImplementation(async () => {
      await takeOver(false);
      return { url: STALE_URL, provider: "builder" };
    });

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: OWNER,
      mediaBytes: new Uint8Array([9, 9, 9]),
      mimeType: "video/webm",
    });

    expect(result).toMatchObject({ status: "skipped-lease", changed: false });
    expect(await thumbnail()).toEqual({
      url: null,
      status: null,
      reason: null,
    });
    expect(mocks.deleteUploadedFile).toHaveBeenCalledWith("builder", {
      url: STALE_URL,
    });
  });

  it("still saves the thumbnail while its lease is live", async () => {
    mocks.uploadRecordingMedia.mockResolvedValue({
      url: STALE_URL,
      provider: "builder",
    });

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: OWNER,
      mediaBytes: new Uint8Array([9, 9, 9]),
      mimeType: "video/webm",
    });

    expect(result).toMatchObject({ status: "generated", changed: true });
    expect(await thumbnail()).toEqual({
      url: STALE_URL,
      status: "generated",
      reason: null,
    });
    expect(await readAppState(ASSET_KEY)).toEqual({
      url: STALE_URL,
      provider: "builder",
    });
  });

  it("says its lease ran out, and writes nothing, when it lapses in the embed check", async () => {
    mocks.recordingEmbedProvider.mockImplementationOnce(() => {
      vi.setSystemTime(Date.now() + LEASE_MS + 1_000);
      return "loom";
    });

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: OWNER,
    });

    expect(result).toMatchObject({
      status: "skipped-lease",
      changed: false,
      detail: expect.stringContaining("lease ran out"),
    });
    expect(await thumbnail()).toEqual({
      url: null,
      status: null,
      reason: null,
    });
  });

  it("can't overwrite its successor's asset record once its saved thumbnail was replaced", async () => {
    await getDb()
      .update(schema.recordings)
      .set({ thumbnailUrl: OLD_URL, thumbnailStatus: "generated" })
      .where(eq(schema.recordings.id, "rec-1"));
    const oldAsset = { url: OLD_URL, provider: "builder" };
    await compareAndSetAppState(ASSET_KEY, null, oldAsset);
    mocks.uploadRecordingMedia.mockResolvedValue({
      url: STALE_URL,
      provider: "builder",
    });
    const takerAsset = { url: TAKER_URL, provider: "builder" };
    mocks.deleteUploadedFile.mockImplementationOnce(async () => {
      const lease = await takeOver(true);
      await compareAndSetAppState(ASSET_KEY, oldAsset, takerAsset, { lease });
      return true;
    });

    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: OWNER,
      thumbnailBytes: new Uint8Array([1, 2, 3]),
      replaceNonEditorThumbnail: true,
    });

    expect(result).toMatchObject({ status: "generated" });
    expect(await thumbnail()).toMatchObject({ url: TAKER_URL });
    expect(await readAppState(ASSET_KEY)).toEqual(takerAsset);
  });

  it("can't mark the thumbnail failed over the one its successor generated", async () => {
    mocks.uploadRecordingMedia.mockImplementation(async () => {
      await takeOver(true);
      return { url: STALE_URL, provider: "builder" };
    });
    const result = await ensureRecordingThumbnail({
      recordingId: "rec-1",
      ownerEmail: OWNER,
      mediaBytes: new Uint8Array([9, 9, 9]),
      mimeType: "video/webm",
    });
    expect(result).toMatchObject({ status: "skipped-lease" });

    await markThumbnailFailed("rec-1", result.status);
    vi.setSystemTime(Date.now() + LEASE_MS + 1_000);
    await markThumbnailFailed("rec-1", result.status);

    expect(await thumbnail()).toEqual({
      url: TAKER_URL,
      status: "generated",
      reason: null,
    });
  });

  it("marks a thumbnail nobody produced as failed", async () => {
    await markThumbnailFailed("rec-1", "skipped-frame-extraction");

    expect(await thumbnail()).toEqual({
      url: null,
      status: "failed",
      reason: "skipped-frame-extraction",
    });
  });
});
