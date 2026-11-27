// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../../../../../db/schema.js";

type FakeEvent = {
  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  requestHeaders: Record<string, string>;
  body: unknown;
  status: number;
};

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const mocks = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  rich: true,
  stopped: false,
  provider: {
    id: "fake-storage",
    resumable: {
      startSession: vi.fn(),
      relayChunk: vi.fn(),
      completeSession: vi.fn(),
      abortSession: vi.fn(),
    },
  },
  abort: vi.fn(),
  upload: vi.fn(),
  rejectHosted: vi.fn(),
  addHosted: vi.fn(),
  deleteUrl: vi.fn(),
  claimLease: vi.fn(),
  releaseLease: vi.fn(),
  renewLease: vi.fn(),
  afterRead: null as null | (() => Promise<void>),
}));

async function holdsLease(lease: { key: string; token: string }) {
  return (
    (
      await client.query(
        "SELECT 1 FROM clips_backfill_leases WHERE lease_key=$1 AND holder=$2 AND expires_at > $3",
        [lease.key, lease.token, Date.now()],
      )
    ).rows.length > 0
  );
}

vi.mock("@agent-native/core/application-state", async () => {
  const { LeaseLostError } = await import("@agent-native/core/db");
  return {
    readAppState: async (key: string) => {
      const value = mocks.state.has(key)
        ? structuredClone(mocks.state.get(key))
        : null;
      const hook = mocks.afterRead;
      mocks.afterRead = null;
      await hook?.();
      return value;
    },
    compareAndSetAppState: async (
      key: string,
      expected: unknown,
      next: unknown,
      options?: { lease?: { key: string; token: string } },
    ) => {
      if (options?.lease && !(await holdsLease(options.lease))) {
        throw new LeaseLostError(options.lease as never);
      }
      const current = mocks.state.get(key) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (next === null) mocks.state.delete(key);
      else mocks.state.set(key, structuredClone(next));
      return true;
    },
    deleteAppState: async (key: string) => {
      mocks.state.delete(key);
    },
  };
});

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, fn: () => unknown) => fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (event: FakeEvent, name: string) => event.params[name],
  readBody: async (event: FakeEvent) => event.body,
  setResponseStatus: (event: FakeEvent, status: number) => {
    event.status = status;
  },
  createError: ({
    statusCode,
    message,
  }: {
    statusCode: number;
    message: string;
  }) => Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../../../../../db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../../../../../db/schema.js"),
}));

vi.mock("../../../../../lib/recording-leases.js", async () => {
  const core = await import("@agent-native/core/db");
  return {
    claimLease: (...args: unknown[]) => mocks.claimLease(...args),
    releaseLease: (...args: unknown[]) => mocks.releaseLease(...args),
    renewLease: (...args: unknown[]) => mocks.renewLease(...args),
    leaseHeld: core.leaseHeld,
    holdsLease,
    isLeaseLost: core.isLeaseLost,
    LeaseLostError: core.LeaseLostError,
  };
});

vi.mock("../../../../../lib/recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: (...args: unknown[]) => mocks.deleteUrl(...args),
}));

vi.mock("../../../../../lib/recording-media-lifecycle.js", () => ({
  withRecordingMediaProduction: async (
    _input: unknown,
    produce: () => Promise<unknown>,
  ) => produce(),
}));

vi.mock("../../../../../lib/recording-policy.js", () => ({
  snapshotRichRecordingPolicy: async () => mocks.rich,
  richRecordingStopped: async () => mocks.stopped,
}));

vi.mock("../../../../../lib/recordings.js", async () => {
  const { eq } = await import("drizzle-orm");
  return {
    getEventOwnerContext: async () => ({
      userEmail: "Owner@example.com",
      orgId: "org-1",
      authUserId: "user-1",
    }),
    ownerEmailMatches: (column: Parameters<typeof eq>[0], email: string) =>
      eq(column, email),
  };
});

vi.mock("../../../../../lib/resumable-upload-cleanup.js", () => ({
  abortResumableUploadSession: (...args: unknown[]) => mocks.abort(...args),
}));

vi.mock("../../../../../lib/resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: async () => mocks.provider,
}));

vi.mock("../../../../../lib/upload-recording-media.js", () => ({
  uploadRecordingMedia: (...args: unknown[]) => mocks.upload(...args),
  deleteRejectedHostedUpload: (...args: unknown[]) =>
    mocks.rejectHosted(...args),
}));

vi.mock("../../../../../lib/video-storage.js", () => ({
  addHostedClipRecordingBytes: (...args: unknown[]) => mocks.addHosted(...args),
}));

import { RETRYABLE_UPLOAD_INTERRUPTION_REASON } from "../../../../../../shared/upload-interruption.js";
import { finalizeRichRecordingSchema } from "../../../../../lib/rich-recording-manifest.js";
import { finalizeRecordingTracks, handleFinalizeTracks } from "./finalize.post";

const resumable = mocks.provider.resumable;
const manifestUrl = "https://storage.example.com/clips/rec-1/manifest.json";
const trackUrl = (track: string) =>
  `https://storage.example.com/clips/rec-1.track-${track}`;
const key = (track: string) => `resumable-session-rec-1-track-${track}`;
const burnedEdits = JSON.stringify({ burnedRedactions: [{ id: "redact-1" }] });
const markedEdits = JSON.stringify({
  overlays: [
    {
      id: "redact-1",
      kind: "redact",
      style: "solid",
      startMs: 2_000,
      endMs: 5_000,
      keys: [{ atMs: 2_000, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    },
  ],
});

function createTable(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const parts = ['"' + column.name + '" ' + column.getSQLType()];
    if (column.primary) parts.push("PRIMARY KEY");
    if (typeof column.default === "string")
      parts.push("DEFAULT '" + column.default.replace(/'/g, "''") + "'");
    else if (
      typeof column.default === "number" ||
      typeof column.default === "boolean"
    )
      parts.push("DEFAULT " + column.default);
    return parts.join(" ");
  });
  return 'CREATE TABLE "' + config.name + '" (' + columns.join(",") + ");";
}

function session(track: string, bytesUploaded: number, meta = {}) {
  mocks.state.set(key(track), {
    providerId: "fake-storage",
    sessionId: `upload-${track}`,
    meta: {
      objectKey: `clips/rec-1.track-${track}`,
      contentType: track === "mic" ? "audio/mp4" : "video/mp4",
      stableUrl: true,
      recordAsset: false,
      clipsHiddenUpload: true,
      uploadGenerationId: "gen-1",
      ...meta,
    },
    bytesUploaded,
    lastCommittedIndex: 0,
  });
}

const body = (tracks: Array<Record<string, unknown>>) => ({
  uploadGenerationId: "gen-1",
  startedAt: "2026-11-11T14:00:00.000-05:00",
  durationMs: 61_000,
  writer: {
    surface: "desktop-macos",
    app: "Clips",
    version: "1.4.0",
    os: "macOS 15.1",
  },
  clock: { host: "mach-host-time" },
  capture: { kind: "display" },
  compat: { offsetMs: 0, cursor: "in-pixels", camera: "bubble" },
  privacy: { keys: "shortcuts", pageInputs: "masked" },
  tracks,
});

const listed = (id: string, meta?: Record<string, unknown>) => ({
  id,
  startMs: 0,
  endMs: 61_000,
  complete: true,
  ...(meta ? { meta } : {}),
});

async function takeLeaseOver() {
  await client.query(
    "UPDATE clips_backfill_leases SET holder='lease-2', expires_at=$1 WHERE lease_key='rich-finalize:rec-1'",
    [Date.now() + 60_000],
  );
}

async function finalizeAsSuccessor(input: unknown) {
  mocks.claimLease.mockImplementationOnce(async (leaseKey: string) => {
    const lease = {
      table: "clips_backfill_leases",
      key: leaseKey,
      token: "lease-2",
      expiresAt: Date.now() + 60_000,
    };
    await client.query(
      "INSERT INTO clips_backfill_leases (lease_key, holder, expires_at) VALUES ($1, $2, $3) ON CONFLICT (lease_key) DO UPDATE SET holder=excluded.holder, expires_at=excluded.expires_at",
      [lease.key, lease.token, lease.expiresAt],
    );
    return lease;
  });
  return finalize(input);
}

async function expectNoKeptFileDeleted() {
  const kept = (await trackRows()).map((row) => row.url);
  const deleted = [
    ...mocks.deleteUrl.mock.calls.map(([url]) => url),
    ...mocks.rejectHosted.mock.calls.map(([input]) => input.url),
  ];
  expect(kept.filter((url) => deleted.includes(url))).toEqual([]);
}

async function finalize(input: unknown) {
  const event = { params: { recordingId: "rec-1" }, body: input, status: 200 };
  const result = await handleFinalizeTracks(event as never);
  return { status: event.status, body: result as Record<string, unknown> };
}

async function recordingRow() {
  return (
    await client.query<{
      media_format: string;
      rich_manifest_url: string | null;
      rich_bytes: number;
    }>(
      "SELECT media_format, rich_manifest_url, rich_bytes::int AS rich_bytes FROM recordings WHERE id='rec-1'",
    )
  ).rows[0];
}

async function trackRows() {
  return (
    await client.query<Record<string, unknown>>(
      "SELECT track, owner_email, url, content_type, bytes::int AS bytes, complete, meta_json FROM recording_tracks ORDER BY track",
    )
  ).rows;
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await client.exec(
    createTable(schema.recordings) +
      createTable(schema.recordingTracks) +
      "CREATE UNIQUE INDEX recording_tracks_recording_track_unique_idx ON recording_tracks (recording_id, track);" +
      "CREATE TABLE clips_backfill_leases (lease_key TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at BIGINT NOT NULL);",
  );
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.state.clear();
  mocks.rich = true;
  mocks.stopped = false;
  await client.exec(
    "TRUNCATE recordings, recording_tracks, clips_backfill_leases CASCADE",
  );
  await client.query(
    "INSERT INTO recordings (id, owner_email, status, storage_mode, upload_generation_id, edits_json, media_format, rich_bytes) VALUES ('rec-1', 'Owner@example.com', 'ready', 'own', 'gen-1', '{}', 'flat', 0)",
  );
  resumable.relayChunk.mockResolvedValue({ ok: true, status: 200 });
  resumable.completeSession.mockImplementation(
    async (upload: { sessionId: string }) =>
      trackUrl(upload.sessionId.replace("upload-", "")),
  );
  mocks.abort.mockResolvedValue(true);
  mocks.upload.mockResolvedValue({ url: manifestUrl, provider: "s3" });
  mocks.deleteUrl.mockResolvedValue(true);
  mocks.addHosted.mockImplementation(
    async (input: { whileCharging?: () => Promise<void> }) => {
      await input.whileCharging?.();
      return { ok: true };
    },
  );
  mocks.rejectHosted.mockRejectedValue(new Error("Hosted storage is full."));
  mocks.claimLease.mockImplementation(async (leaseKey: string) => {
    const lease = {
      table: "clips_backfill_leases",
      key: leaseKey,
      token: "lease-1",
      expiresAt: Date.now() + 60_000,
    };
    await client.query(
      "INSERT INTO clips_backfill_leases (lease_key, holder, expires_at) VALUES ($1, $2, $3) ON CONFLICT (lease_key) DO UPDATE SET holder=excluded.holder, expires_at=excluded.expires_at",
      [lease.key, lease.token, lease.expiresAt],
    );
    return lease;
  });
  mocks.releaseLease.mockResolvedValue(undefined);
  mocks.renewLease.mockImplementation(
    async (lease: { key: string; token: string }, ttlMs: number) =>
      (
        await client.query(
          "UPDATE clips_backfill_leases SET expires_at=$3 WHERE lease_key=$1 AND holder=$2 AND expires_at > $4 RETURNING holder",
          [lease.key, lease.token, Date.now() + ttlMs, Date.now()],
        )
      ).rows.length > 0,
  );
  mocks.afterRead = null;
});

async function setEdits(editsJson: string) {
  await client.query("UPDATE recordings SET edits_json=$1", [editsJson]);
}

afterAll(async () => {
  await client.close();
});

describe("POST /api/uploads/:recordingId/tracks/finalize", () => {
  it("refuses a request that isn't a finalize", async () => {
    const { status, body: result } = await finalize({ tracks: [] });
    expect(status).toBe(400);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.any(String) }),
      ]),
    );
  });

  it("waits for the recording itself to be finalized", async () => {
    await client.query("UPDATE recordings SET status='uploading'");
    session("screen", 10);
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({
      recordingNotFinalized: true,
      retryable: true,
    });
    expect(resumable.completeSession).not.toHaveBeenCalled();
  });

  it("stops tracks for a failed recording, but waits out an interrupted upload", async () => {
    session("screen", 10);
    await client.query(
      "UPDATE recordings SET status='failed', failure_reason='Upload failed'",
    );
    const failed = await finalize(body([listed("screen")]));
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ tracksStopped: true });

    await client.query("UPDATE recordings SET failure_reason=$1", [
      RETRYABLE_UPLOAD_INTERRUPTION_REASON,
    ]);
    const interrupted = await finalize(body([listed("screen")]));
    expect(interrupted.status).toBe(409);
    expect(interrupted.body).toMatchObject({ retryable: true });
    expect(interrupted.body).not.toHaveProperty("tracksStopped");
    expect(resumable.completeSession).not.toHaveBeenCalled();
    expect(mocks.state.has(key("screen"))).toBe(true);
  });

  it("refuses tracks when the owner's lab was off", async () => {
    mocks.rich = false;
    session("screen", 10);
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(403);
    expect(result).toMatchObject({ labDisabled: true, tracksStopped: true });
  });

  it("keeps each stored track, writes the manifest, and marks the recording rich", async () => {
    session("screen", 10);
    session("mic", 4);
    session("camera", 3);

    const { status, body: result } = await finalize(
      body([
        listed("screen", { codec: "avc1.640028", secret: "drop me" }),
        listed("mic"),
        listed("transcript"),
      ]),
    );

    expect(status).toBe(200);
    expect(result).toEqual({
      ok: true,
      recordingId: "rec-1",
      mediaFormat: "rich",
      richBytes: 14,
      tracks: expect.arrayContaining([
        { id: "mic", bytes: 4, complete: true },
        { id: "screen", bytes: 10, complete: true },
      ]),
      droppedTracks: [{ id: "transcript", reason: "not_uploaded" }],
    });
    expect(resumable.relayChunk.mock.calls.map(([, range]) => range)).toEqual(
      expect.arrayContaining(["bytes */10", "bytes */4"]),
    );
    // The recorder didn't list the camera, so its upload is cancelled.
    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.abort.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "upload-camera",
    });
    expect([...mocks.state.keys()]).toEqual([]);

    expect(await trackRows()).toEqual([
      {
        track: "mic",
        owner_email: "owner@example.com",
        url: trackUrl("mic"),
        content_type: "audio/mp4",
        bytes: 4,
        complete: true,
        meta_json: "{}",
      },
      {
        track: "screen",
        owner_email: "owner@example.com",
        url: trackUrl("screen"),
        content_type: "video/mp4",
        bytes: 10,
        complete: true,
        meta_json: JSON.stringify({ codec: "avc1.640028" }),
      },
    ]);
    expect(await recordingRow()).toEqual({
      media_format: "rich",
      rich_manifest_url: manifestUrl,
      rich_bytes: 14,
    });

    const [upload] = mocks.upload.mock.calls[0] as [{ data: Uint8Array }];
    expect(upload).toMatchObject({
      recordingId: "rec-1",
      filename: "manifest.json",
      mimeType: "application/json",
      recordAsset: false,
    });
    const manifest = JSON.parse(new TextDecoder().decode(upload.data));
    expect(
      manifest.tracks.map((track: { file: string }) => track.file),
    ).toEqual(["screen.mp4", "mic.mp4"]);
    expect(JSON.stringify(manifest)).not.toContain("storage.example.com");
  });

  it("answers again with what it holds, without completing anything twice", async () => {
    session("screen", 10);
    await finalize(body([listed("screen")]));
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(200);
    expect(result).toMatchObject({
      mediaFormat: "rich",
      richBytes: 10,
      alreadyFinalized: true,
    });
    expect(resumable.completeSession).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("completes a track its last chunk already closed, without closing it again", async () => {
    session("screen", 10);
    mocks.state.set(key("screen"), {
      ...(mocks.state.get(key("screen")) as Record<string, unknown>),
      providerClosed: true,
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(200);
    expect(result).toMatchObject({ mediaFormat: "rich", richBytes: 10 });
    expect(resumable.relayChunk).not.toHaveBeenCalled();
    expect(resumable.completeSession).toHaveBeenCalledTimes(1);
  });

  it("completes and deletes a closed upload it drops, since a closed upload can't be cancelled", async () => {
    session("screen", 10, { uploadGenerationId: "gen-0" });
    mocks.state.set(key("screen"), {
      ...(mocks.state.get(key("screen")) as Record<string, unknown>),
      providerClosed: true,
    });
    const { body: result } = await finalize(body([listed("screen")]));
    expect(result).toMatchObject({
      mediaFormat: "flat",
      droppedTracks: [{ id: "screen", reason: "not_uploaded" }],
    });
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(resumable.completeSession).toHaveBeenCalledTimes(1);
    expect(mocks.deleteUrl).toHaveBeenCalledWith(trackUrl("screen"), {
      storageMode: "own",
      recordingId: "rec-1",
    });
    expect(mocks.state.has(key("screen"))).toBe(false);
  });

  it("finalizes one request at a time for a recording, and lets the lease go after", async () => {
    session("screen", 10);
    mocks.claimLease.mockResolvedValueOnce(null);
    const busy = await finalize(body([listed("screen")]));
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ retryable: true });
    expect(resumable.completeSession).not.toHaveBeenCalled();

    await finalize(body([listed("screen")]));
    expect(mocks.claimLease).toHaveBeenLastCalledWith(
      "rich-finalize:rec-1",
      expect.any(Number),
    );
    expect(mocks.releaseLease).toHaveBeenCalledWith(
      expect.objectContaining({ key: "rich-finalize:rec-1" }),
    );
  });

  it("stops, storing nothing more, once its lease has lapsed", async () => {
    session("screen", 10);
    mocks.renewLease.mockResolvedValueOnce(false);
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(resumable.completeSession).not.toHaveBeenCalled();
    expect(await trackRows()).toEqual([]);
    expect(mocks.releaseLease).toHaveBeenCalled();
  });

  it("keeps no track once another finalize took its lapsed lease over", async () => {
    session("screen", 10);
    resumable.completeSession.mockImplementationOnce(async () => {
      await takeLeaseOver();
      return trackUrl("screen");
    });

    const { status, body: result } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(result).toMatchObject({
      error:
        "This finalize ran too long, so another may have taken over. Finalize again.",
      retryable: true,
    });
    expect(await trackRows()).toEqual([]);
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
  });

  it("deletes its own manifest, at a URL only its upload has, once another finalize took its lapsed lease over", async () => {
    session("screen", 10);
    mocks.upload.mockImplementationOnce(async () => {
      await takeLeaseOver();
      return { url: manifestUrl, provider: "s3" };
    });

    const { status, body: result } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(await recordingRow()).toEqual({
      media_format: "flat",
      rich_manifest_url: null,
      rich_bytes: 0,
    });
    expect(mocks.deleteUrl).toHaveBeenCalledWith(manifestUrl, {
      storageMode: "own",
      recordingId: "rec-1",
    });
  });

  it("leaves a manifest at a URL another upload can share to the finalize that took its lapsed lease over", async () => {
    session("screen", 10);
    mocks.upload.mockImplementationOnce(async () => {
      await takeLeaseOver();
      return { url: manifestUrl, provider: "builder" };
    });

    const { status, body: result } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(await recordingRow()).toMatchObject({ media_format: "flat" });
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
  });

  it("leaves a shared manifest URL the recording already points to", async () => {
    session("screen", 10);
    mocks.upload.mockImplementationOnce(async () => {
      await client.query(
        "UPDATE recordings SET media_format='rich', rich_manifest_url=$1, rich_bytes=10",
        [manifestUrl],
      );
      return { url: manifestUrl, provider: "builder" };
    });

    const { body: result } = await finalize(body([listed("screen")]));

    expect(result).toMatchObject({
      mediaFormat: "rich",
      alreadyFinalized: true,
    });
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
  });

  it("doesn't delete the file of an unlisted track another finalize kept after taking its lease over", async () => {
    session("screen", 10, {
      completedUrl: trackUrl("screen"),
    });
    session("mic", 4);
    mocks.afterRead = async () => {
      await takeLeaseOver();
      await client.query(
        `INSERT INTO recording_tracks (id, recording_id, track, owner_email, url, content_type, bytes) VALUES ('t-screen', 'rec-1', 'screen', 'owner@example.com', '${trackUrl("screen")}', 'video/mp4', 10)`,
      );
      mocks.state.delete(key("screen"));
    };

    const { status, body: result } = await finalize(body([listed("mic")]));

    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
    expect(await trackRows()).toEqual([
      expect.objectContaining({ track: "screen", url: trackUrl("screen") }),
    ]);
  });

  it("doesn't count again, or delete, a hosted track another finalize counted and kept after taking its lease over", async () => {
    await client.query("UPDATE recordings SET storage_mode='hosted'");
    session("screen", 10);
    mocks.addHosted.mockResolvedValue({ ok: false });
    resumable.completeSession.mockImplementationOnce(async () => {
      await takeLeaseOver();
      await client.query(
        `INSERT INTO recording_tracks (id, recording_id, track, owner_email, url, content_type, bytes) VALUES ('t-screen', 'rec-1', 'screen', 'owner@example.com', '${trackUrl("screen")}', 'video/mp4', 10)`,
      );
      mocks.state.delete(key("screen"));
      return trackUrl("screen");
    });

    const { status } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(mocks.addHosted).not.toHaveBeenCalled();
    expect(mocks.rejectHosted).not.toHaveBeenCalled();
    expect(await trackRows()).toEqual([
      expect.objectContaining({ track: "screen", url: trackUrl("screen") }),
    ]);
  });

  it("doesn't complete an upload it closed after another finalize took its lease over", async () => {
    session("screen", 10);
    resumable.relayChunk.mockImplementationOnce(async () => {
      await takeLeaseOver();
      return { ok: true, status: 200 };
    });

    const { status } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(resumable.completeSession).not.toHaveBeenCalled();
    expect(mocks.state.get(key("screen"))).toMatchObject({
      sessionId: "upload-screen",
    });
    expect(mocks.state.get(key("screen"))).not.toHaveProperty("providerClosed");
  });

  it("doesn't delete what another finalize recorded on a session storage refused it", async () => {
    session("screen", 10);
    resumable.relayChunk.mockImplementationOnce(async () => {
      await takeLeaseOver();
      const current = mocks.state.get(key("screen")) as {
        meta: Record<string, unknown>;
      };
      mocks.state.set(key("screen"), {
        ...current,
        providerClosed: true,
        meta: { ...current.meta, completedUrl: trackUrl("screen") },
      });
      return { ok: false, status: 410 };
    });

    const { status } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(mocks.state.get(key("screen"))).toMatchObject({
      meta: { completedUrl: trackUrl("screen") },
    });
  });

  it("doesn't discard a stopped track's upload once its lease was taken over", async () => {
    session("screen", 10);
    mocks.stopped = true;
    const stopped = await import("../../../../../lib/recording-policy.js");
    vi.spyOn(stopped, "richRecordingStopped").mockImplementationOnce(
      async () => {
        void takeLeaseOver();
        return true;
      },
    );

    const { status } = await finalize(body([listed("screen")]));

    expect(status).toBe(409);
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
    expect(mocks.state.get(key("screen"))).toMatchObject({
      meta: { completedUrl: trackUrl("screen") },
    });
  });

  it("keeps a newer upload a chunk started while an earlier one was cancelled", async () => {
    session("screen", 10, { uploadGenerationId: "gen-0" });
    const newer = {
      providerId: "fake-storage",
      sessionId: "upload-newer",
      meta: {
        objectKey: "clips/rec-1.track-screen",
        uploadGenerationId: "gen-1",
      },
      bytesUploaded: 4,
      lastCommittedIndex: 0,
    };
    mocks.abort.mockImplementationOnce(async () => {
      mocks.state.set(key("screen"), newer);
      return true;
    });
    await finalize(body([listed("screen")]));
    expect(mocks.state.get(key("screen"))).toEqual(newer);
  });

  it("drops a track upload left from an earlier upload generation", async () => {
    session("screen", 10, { uploadGenerationId: "gen-0" });
    const { body: result } = await finalize(body([listed("screen")]));
    expect(result).toMatchObject({
      mediaFormat: "flat",
      droppedTracks: [{ id: "screen", reason: "not_uploaded" }],
    });
    expect(resumable.completeSession).not.toHaveBeenCalled();
    expect(mocks.abort.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "upload-screen",
    });
    expect(mocks.state.has(key("screen"))).toBe(false);
  });

  it("drops only the session a stored track left behind, never the track's file", async () => {
    await client.query(
      `INSERT INTO recording_tracks (id, recording_id, track, owner_email, url, content_type, bytes) VALUES ('t-screen', 'rec-1', 'screen', 'owner@example.com', '${trackUrl("screen")}', 'video/mp4', 10)`,
    );
    session("screen", 10, { completedUrl: trackUrl("screen") });
    session("mic", 4);
    const { status, body: result } = await finalize(
      body([listed("screen"), listed("mic")]),
    );
    expect(status).toBe(200);
    expect(result).toMatchObject({ mediaFormat: "rich", richBytes: 14 });
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
    expect(mocks.state.has(key("screen"))).toBe(false);
    expect((await trackRows()).map((row) => row.url)).toEqual([
      trackUrl("mic"),
      trackUrl("screen"),
    ]);
  });

  it("never deletes a completed file another finalize already stored", async () => {
    session("screen", 10);
    resumable.completeSession.mockImplementationOnce(async () => {
      await client.query(
        `INSERT INTO recording_tracks (id, recording_id, track, owner_email, url, content_type, bytes) VALUES ('t-screen', 'rec-1', 'screen', 'owner@example.com', '${trackUrl("screen")}', 'video/mp4', 10)`,
      );
      mocks.state.delete(key("screen"));
      return trackUrl("screen");
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
    expect(await trackRows()).toEqual([
      expect.objectContaining({ track: "screen", url: trackUrl("screen") }),
    ]);
  });

  it("leaves a row another finalize stored first, and deletes its own file instead", async () => {
    session("screen", 10);
    resumable.completeSession.mockImplementationOnce(async () => {
      await client.query(
        `INSERT INTO recording_tracks (id, recording_id, track, owner_email, url, content_type, bytes) VALUES ('t-other', 'rec-1', 'screen', 'owner@example.com', 'https://storage.example.com/clips/rec-1.track-screen-other', 'video/mp4', 10)`,
      );
      mocks.state.delete(key("screen"));
      return trackUrl("screen");
    });
    const { status } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(mocks.deleteUrl).toHaveBeenCalledWith(trackUrl("screen"), {
      storageMode: "own",
      recordingId: "rec-1",
    });
    expect((await trackRows())[0]).toMatchObject({
      url: "https://storage.example.com/clips/rec-1.track-screen-other",
    });
  });

  it("reuses a track storage already completed when a finalize is retried", async () => {
    session("screen", 10, {
      completedUrl: trackUrl("screen"),
    });
    await finalize(body([listed("screen")]));
    expect(resumable.relayChunk).not.toHaveBeenCalled();
    expect(resumable.completeSession).not.toHaveBeenCalled();
    expect((await trackRows())[0]).toMatchObject({ url: trackUrl("screen") });
  });

  it("drops a track storage refuses, and stays flat when none are left", async () => {
    session("screen", 10);
    resumable.relayChunk.mockResolvedValueOnce({ ok: false, status: 410 });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(200);
    expect(result).toMatchObject({
      mediaFormat: "flat",
      tracksStopped: true,
      droppedTracks: [{ id: "screen", reason: "storage_refused" }],
    });
    expect(await recordingRow()).toMatchObject({ media_format: "flat" });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("asks for a retry while storage is briefly unavailable", async () => {
    session("screen", 10);
    resumable.relayChunk.mockResolvedValueOnce({ ok: false, status: 503 });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(502);
    expect(result).toMatchObject({ retryable: true });
    expect(mocks.state.has(key("screen"))).toBe(true);
  });

  it("keeps no tracks once a redaction was burned into the video", async () => {
    await setEdits(burnedEdits);
    session("screen", 10);
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ tracksStopped: true });
    expect(mocks.abort).toHaveBeenCalledTimes(1);
    expect(mocks.state.has(key("screen"))).toBe(false);
    expect(resumable.completeSession).not.toHaveBeenCalled();
  });

  it("deletes a completed track's file, rather than cancelling it, once a redaction is burned", async () => {
    await setEdits(burnedEdits);
    session("screen", 10, { completedUrl: trackUrl("screen") });
    await finalize(body([listed("screen")]));
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.deleteUrl).toHaveBeenCalledWith(trackUrl("screen"), {
      storageMode: "own",
      recordingId: "rec-1",
    });
    expect(mocks.state.has(key("screen"))).toBe(false);
  });

  it("removes tracks a finalize stored before a redaction was burned", async () => {
    await client.query(
      `INSERT INTO recording_tracks (id, recording_id, track, owner_email, url, content_type, bytes) VALUES ('t-1', 'rec-1', 'screen', 'owner@example.com', '${trackUrl("screen")}', 'video/mp4', 10)`,
    );
    await setEdits(burnedEdits);
    // The burn also stopped the recording keeping tracks.
    mocks.rich = false;
    const { status } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(mocks.deleteUrl).toHaveBeenCalledWith(
      trackUrl("screen"),
      expect.objectContaining({ recordingId: "rec-1" }),
    );
    expect(await trackRows()).toEqual([]);
  });

  it("waits while redactions are marked but not yet applied", async () => {
    await setEdits(markedEdits);
    session("screen", 10);
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ redactionPending: true, retryable: true });
    expect(resumable.completeSession).not.toHaveBeenCalled();
    expect(mocks.state.has(key("screen"))).toBe(true);
  });

  it("doesn't keep a track when redactions are marked while it completes", async () => {
    session("screen", 10);
    resumable.completeSession.mockImplementationOnce(async () => {
      await setEdits(markedEdits);
      return trackUrl("screen");
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(await trackRows()).toEqual([]);
    // The completed file waits on its session for the burn or the retry.
    expect(mocks.state.get(key("screen"))).toMatchObject({
      meta: { completedUrl: trackUrl("screen") },
    });
    expect(mocks.deleteUrl).not.toHaveBeenCalled();
  });

  it("deletes a completed track itself when a burn already discarded its upload", async () => {
    session("screen", 10);
    resumable.completeSession.mockImplementationOnce(async () => {
      await setEdits(markedEdits);
      mocks.state.delete(key("screen"));
      return trackUrl("screen");
    });
    const { status } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(await trackRows()).toEqual([]);
    expect(mocks.deleteUrl).toHaveBeenCalledWith(trackUrl("screen"), {
      storageMode: "own",
      recordingId: "rec-1",
    });
  });

  it("keeps no track when a burn stops the recording mid-finalize, even once its marks are cleared", async () => {
    session("screen", 10);
    // The burn saved its stop after this finalize's first check, and the
    // owner cleared the marks again, so the recording's edits look unchanged.
    resumable.completeSession.mockImplementationOnce(async () => {
      mocks.stopped = true;
      return trackUrl("screen");
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(403);
    expect(result).toMatchObject({ tracksStopped: true });
    expect(await trackRows()).toEqual([]);
    expect(await recordingRow()).toMatchObject({ media_format: "flat" });
    expect(mocks.deleteUrl).toHaveBeenCalledWith(trackUrl("screen"), {
      storageMode: "own",
      recordingId: "rec-1",
    });
    expect(mocks.state.has(key("screen"))).toBe(false);
  });

  it("stays flat when a burn stops the recording just before it turns rich", async () => {
    session("screen", 10);
    mocks.upload.mockImplementationOnce(async () => {
      mocks.stopped = true;
      return { url: manifestUrl, provider: "s3" };
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(403);
    expect(result).toMatchObject({ tracksStopped: true });
    expect(await recordingRow()).toMatchObject({
      media_format: "flat",
      rich_manifest_url: null,
    });
    expect(mocks.deleteUrl).toHaveBeenCalledWith(manifestUrl, {
      storageMode: "own",
      recordingId: "rec-1",
    });
  });

  it("keeps no track when a retry starts a new upload attempt mid-finalize", async () => {
    session("screen", 10);
    resumable.completeSession.mockImplementationOnce(async () => {
      await client.query(
        "UPDATE recordings SET upload_generation_id='gen-2', status='uploading'",
      );
      return trackUrl("screen");
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(await trackRows()).toEqual([]);
    expect(await recordingRow()).toMatchObject({ media_format: "flat" });
  });

  it("stays flat and asks for a retry when the recording's edits change mid-finalize", async () => {
    session("screen", 10);
    mocks.upload.mockImplementationOnce(async () => {
      await setEdits(burnedEdits);
      return { url: manifestUrl, provider: "s3" };
    });
    const { status, body: result } = await finalize(body([listed("screen")]));
    expect(status).toBe(409);
    expect(result).toMatchObject({ retryable: true });
    expect(await recordingRow()).toMatchObject({
      media_format: "flat",
      rich_manifest_url: null,
    });
    expect(mocks.deleteUrl).toHaveBeenCalledWith(manifestUrl, {
      storageMode: "own",
      recordingId: "rec-1",
    });

    // The retry sees the burn and removes what the first try stored.
    const retry = await finalize(body([listed("screen")]));
    expect(retry.status).toBe(409);
    expect(retry.body).toMatchObject({ tracksStopped: true });
    expect(await trackRows()).toEqual([]);
  });

  it("counts hosted tracks only after the recording's own bytes, keeping a completed track for the retry", async () => {
    await client.query("UPDATE recordings SET storage_mode='hosted'");
    session("screen", 10);
    mocks.addHosted.mockRejectedValueOnce(
      new Error("Recording allowance is not consumed yet."),
    );

    const first = await finalize(body([listed("screen")]));
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({
      recordingNotFinalized: true,
      retryable: true,
    });
    expect(mocks.state.get(key("screen"))).toMatchObject({
      providerClosed: true,
      meta: { completedUrl: trackUrl("screen") },
    });

    const second = await finalize(body([listed("screen")]));
    expect(second.body).toMatchObject({ mediaFormat: "rich", richBytes: 10 });
    expect(resumable.completeSession).toHaveBeenCalledTimes(1);
    expect(mocks.addHosted).toHaveBeenLastCalledWith(
      expect.objectContaining({ recordingId: "rec-1", additionalBytes: 10 }),
    );
  });

  it("counts a hosted track once, even when its row is written on a retry", async () => {
    await client.query("UPDATE recordings SET storage_mode='hosted'");
    session("screen", 10);
    // An edit that isn't a redaction still sends the finalize round again.
    mocks.addHosted.mockImplementationOnce(
      async (input: { whileCharging?: () => Promise<void> }) => {
        await input.whileCharging?.();
        await setEdits(JSON.stringify({ trims: [] }));
        return { ok: true };
      },
    );

    const first = await finalize(body([listed("screen")]));
    expect(first.status).toBe(409);
    expect(mocks.state.get(key("screen"))).toMatchObject({
      meta: { completedUrl: trackUrl("screen"), hostedBytesCounted: true },
    });

    const second = await finalize(body([listed("screen")]));
    expect(second.body).toMatchObject({ mediaFormat: "rich", richBytes: 10 });
    expect(mocks.addHosted).toHaveBeenCalledTimes(1);
  });

  it("drops a hosted track that doesn't fit and deletes its file", async () => {
    await client.query("UPDATE recordings SET storage_mode='hosted'");
    session("screen", 10);
    mocks.addHosted.mockResolvedValueOnce({ ok: false });
    // Once the file is gone, the helper throws the failure it was given.
    mocks.rejectHosted.mockImplementationOnce(
      async (input: { failure: Error }) => {
        throw input.failure;
      },
    );
    const { body: result } = await finalize(body([listed("screen")]));
    expect(result).toMatchObject({
      mediaFormat: "flat",
      droppedTracks: [{ id: "screen", reason: "storage_full" }],
    });
    expect(mocks.rejectHosted).toHaveBeenCalledWith(
      expect.objectContaining({ url: trackUrl("screen"), additionalBytes: 10 }),
    );
    expect(mocks.state.has(key("screen"))).toBe(false);
  });

  it("keeps the session of a hosted track that doesn't fit while storage keeps its file", async () => {
    await client.query("UPDATE recordings SET storage_mode='hosted'");
    session("screen", 10);
    mocks.addHosted.mockResolvedValueOnce({ ok: false });
    mocks.rejectHosted.mockRejectedValueOnce(
      new Error("The uploaded derivative could not be deleted."),
    );
    const { body: result } = await finalize(body([listed("screen")]));
    expect(result).toMatchObject({
      droppedTracks: [{ id: "screen", reason: "storage_full" }],
    });
    expect(mocks.state.get(key("screen"))).toMatchObject({
      meta: { completedUrl: trackUrl("screen") },
    });
  });

  describe("a finalize that stalls past its lease mid-delete (SC-05)", () => {
    it("can't delete an upload it was discarding that the finalize that took over kept", async () => {
      session("screen", 10);
      mocks.state.set(key("screen"), {
        ...(mocks.state.get(key("screen")) as Record<string, unknown>),
        providerClosed: true,
      });
      session("mic", 4);
      let successor: Awaited<ReturnType<typeof finalize>> | undefined;
      resumable.completeSession.mockImplementationOnce(async () => {
        successor = await finalizeAsSuccessor(
          body([listed("screen"), listed("mic")]),
        );
        return trackUrl("screen");
      });

      const { status } = await finalize(body([listed("mic")]));

      expect(status).toBe(409);
      await expectNoKeptFileDeleted();
      expect(successor?.body).toMatchObject({
        droppedTracks: [{ id: "screen", reason: "not_uploaded" }],
      });
      expect(mocks.state.has(key("screen"))).toBe(false);
    });

    it("can't delete a stopped track's upload that the finalize that took over kept", async () => {
      session("screen", 10);
      mocks.stopped = true;
      mocks.deleteUrl.mockImplementationOnce(async () => {
        mocks.stopped = false;
        await finalizeAsSuccessor(body([listed("screen")]));
        return true;
      });

      await finalize(body([listed("screen")]));

      await expectNoKeptFileDeleted();
    });

    it("can't delete a hosted track over the limit once a finalize that took over counted and kept it", async () => {
      await client.query("UPDATE recordings SET storage_mode='hosted'");
      session("screen", 10);
      mocks.addHosted.mockImplementationOnce(async () => ({ ok: false }));
      mocks.rejectHosted.mockImplementationOnce(
        async (input: { failure: Error }) => {
          await finalizeAsSuccessor(body([listed("screen")]));
          throw input.failure;
        },
      );

      await finalize(body([listed("screen")]));

      await expectNoKeptFileDeleted();
    });

    it("counts a hosted track once when its lease lapses while it is counted", async () => {
      await client.query("UPDATE recordings SET storage_mode='hosted'");
      session("screen", 10);
      let charged = 0;
      const charge = async (input: { whileCharging?: () => Promise<void> }) => {
        await input.whileCharging?.();
        charged += 1;
        return { ok: true };
      };
      mocks.addHosted.mockImplementation(charge);
      mocks.addHosted.mockImplementationOnce(
        async (input: { whileCharging?: () => Promise<void> }) => {
          await takeLeaseOver();
          return charge(input);
        },
      );

      const first = await finalize(body([listed("screen")]));
      expect(first.status).toBe(409);
      await client.query("DELETE FROM clips_backfill_leases");
      const second = await finalize(body([listed("screen")]));

      expect(second.body).toMatchObject({ mediaFormat: "rich", richBytes: 10 });
      expect(charged).toBe(1);
    });

    it("keeps a session a chunk moved on after it read it, even once storage refused the upload", async () => {
      session("screen", 10);
      resumable.relayChunk.mockImplementationOnce(async () => {
        const current = mocks.state.get(key("screen")) as Record<
          string,
          unknown
        >;
        mocks.state.set(key("screen"), {
          ...current,
          bytesUploaded: 14,
          lastCommittedIndex: 1,
        });
        return { ok: false, status: 410 };
      });

      await finalize(body([listed("screen")]));

      expect(mocks.state.get(key("screen"))).toMatchObject({
        sessionId: "upload-screen",
        bytesUploaded: 14,
      });
    });

    it("answers that the recording is finalized when the finalize that took its lease over finished it", async () => {
      session("screen", 10);
      mocks.upload.mockImplementationOnce(async () => {
        await takeLeaseOver();
        await client.query(
          "UPDATE recordings SET media_format='rich', rich_manifest_url=$1, rich_bytes=10",
          [manifestUrl],
        );
        return { url: manifestUrl, provider: "builder" };
      });

      const { status, body: result } = await finalize(body([listed("screen")]));

      expect(status).toBe(200);
      expect(result).toMatchObject({
        ok: true,
        mediaFormat: "rich",
        alreadyFinalized: true,
      });
      expect(mocks.deleteUrl).not.toHaveBeenCalledWith(
        manifestUrl,
        expect.anything(),
      );
    });

    it("leaves a surplus manifest at a URL storage can hand out again, even with its lease live", async () => {
      session("screen", 10);
      mocks.upload.mockImplementationOnce(async () => {
        await setEdits(JSON.stringify({ trims: [] }));
        return { url: manifestUrl, provider: "builder" };
      });

      const { status } = await finalize(body([listed("screen")]));

      expect(status).toBe(409);
      expect(mocks.deleteUrl).not.toHaveBeenCalledWith(
        manifestUrl,
        expect.anything(),
      );
    });
  });

  it("refuses a finalize from an earlier upload generation", async () => {
    session("screen", 10);
    const { status, body: result } = await finalize({
      ...body([listed("screen")]),
      uploadGenerationId: "gen-0",
    });
    expect(status).toBe(409);
    expect(result).toMatchObject({ staleAttempt: true });
  });

  it("finalizes for a caller with no request, as the sweep does with a recorder's draft", async () => {
    session("screen", 10);
    const setStatus = vi.fn();
    const result = await finalizeRecordingTracks({
      recordingId: "rec-1",
      input: finalizeRichRecordingSchema.parse({
        ...body([{ ...listed("screen"), endMs: 30_000, complete: false }]),
        status: "recovered",
      }),
      ownerEmail: "Owner@example.com",
      setStatus,
    });
    expect(result).toMatchObject({
      ok: true,
      mediaFormat: "rich",
      richBytes: 10,
    });
    expect(setStatus).not.toHaveBeenCalled();
    const [upload] = mocks.upload.mock.calls[0] as [{ data: Uint8Array }];
    const manifest = JSON.parse(new TextDecoder().decode(upload.data));
    expect(manifest.status).toBe("recovered");
    expect(manifest.tracks).toMatchObject([
      { id: "screen", endMs: 30_000, complete: false },
    ]);
  });

  it("gives that caller the status of a refusal", async () => {
    session("screen", 10);
    await client.query(
      "UPDATE recordings SET status='failed', failure_reason='Upload failed'",
    );
    const setStatus = vi.fn();
    const result = await finalizeRecordingTracks({
      recordingId: "rec-1",
      input: finalizeRichRecordingSchema.parse(body([listed("screen")])),
      ownerEmail: "Owner@example.com",
      setStatus,
    });
    expect(result).toMatchObject({ ok: false, tracksStopped: true });
    expect(setStatus).toHaveBeenCalledWith(409);
  });
});
