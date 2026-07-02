import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const putPrivateBlobMock = vi.hoisted(() => vi.fn());
const deletePrivateBlobMock = vi.hoisted(() => vi.fn());
const readPrivateBlobMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());

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
  putPrivateBlob: putPrivateBlobMock,
  readPrivateBlob: readPrivateBlobMock,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    resolveAccess: resolveAccessMock,
  };
});

import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

import {
  assertReplayKeyBudget,
  getSessionReplaySummary,
  listSessionRecordings,
  parseSessionReplayIngestPayload,
  readSessionReplayChunkBytes,
  recordSessionReplayChunks,
} from "./session-replay";

function createBudgetDbMock(results: unknown[][]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(results.shift() ?? [])),
      })),
    })),
  };
}

function createReplayDbMock(results: unknown[][]) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const deletes: Array<{ table: unknown; where: unknown }> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = results.shift() ?? [];
          return {
            limit: vi.fn(async () => rows),
            then: (
              resolve: (value: unknown[]) => void,
              reject?: (reason: unknown) => void,
            ) => Promise.resolve(rows).then(resolve, reject),
          };
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        return {
          onConflictDoNothing: vi.fn(async () => undefined),
        };
      }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async (where: unknown) => {
        deletes.push({ table, where });
      }),
    })),
  };
  return { db, inserts, deletes };
}

function createSessionReplayListDbMock(rows: unknown[]) {
  let whereCondition: unknown;
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((where: unknown) => {
          whereCondition = where;
          return {
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => rows),
            })),
          };
        }),
      })),
    })),
  };
  return {
    db,
    get whereCondition() {
      return whereCondition;
    },
  };
}

function conditionText(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "object" && item !== null) {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    if (typeof item === "function") {
      return `[Function ${item.name || "anonymous"}]`;
    }
    return item;
  });
}

describe("session replay ingest parsing", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    putPrivateBlobMock.mockReset();
    deletePrivateBlobMock.mockReset();
    readPrivateBlobMock.mockReset();
    resolveAccessMock.mockReset();
  });

  it("normalizes recorder payloads into session recording chunks", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      sequence: 2,
      url: "https://example.com/signup?code=redacted",
      app: "signup",
      events: [
        { type: 4, timestamp: 1, data: { href: "https://example.com" } },
      ],
    });

    expect(parsed).toMatchObject({
      publicKey: "anpk_test",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      app: "signup",
      pageCount: 2,
    });
    expect(parsed.chunks).toHaveLength(1);
    expect(parsed.chunks[0]).toMatchObject({
      seq: 2,
      eventCount: 1,
      storageKind: "inline",
    });
  });

  it("accepts full snapshot chunks larger than the SQL inline fallback cap", () => {
    const fullSnapshotText = "x".repeat(300 * 1024);
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      sequence: 1,
      events: [
        {
          type: 2,
          timestamp: 1,
          data: {
            node: {
              type: 2,
              tagName: "html",
              childNodes: [{ type: 3, textContent: fullSnapshotText }],
            },
          },
        },
      ],
    });

    expect(parsed.chunks[0]).toMatchObject({
      seq: 1,
      eventCount: 1,
      storageKind: "inline",
    });
    expect(parsed.chunks[0]?.byteLength).toBeGreaterThan(256 * 1024);
  });

  it("accepts anonymous replay payloads without a signed-in user email", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      anonymousId: "anon_1",
      sequence: 2,
      events: [{ type: 4, timestamp: 1 }],
    });

    expect(parsed).toMatchObject({
      publicKey: "anpk_test",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: null,
      anonymousId: "anon_1",
      userKey: "anon_1",
    });
    expect(parsed.chunks).toHaveLength(1);
  });

  it("rejects metadata-only recordings from direct summary reads", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "sr_empty",
        clientRecordingId: "recording_1",
        sessionId: "session_1",
        userId: "dev@example.com",
        anonymousId: null,
        userKey: "dev@example.com",
        startedAt: "2026-01-01T00:00:00.000Z",
        chunkCount: 0,
        eventCount: 0,
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        visibility: "private",
      },
    });

    await expect(
      getSessionReplaySummary("sr_empty", {
        userEmail: "owner@example.com",
        orgId: "org_123",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Session recording not found",
    });
  });

  it("rejects anonymous recordings from direct summary reads", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "sr_anonymous",
        clientRecordingId: "recording_1",
        sessionId: "session_1",
        userId: null,
        anonymousId: "anon_1",
        userKey: "anon_1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        durationMs: null,
        chunkCount: 1,
        eventCount: 1,
        totalBytes: 128,
        pageCount: 1,
        errorCount: 0,
        rageClickCount: 0,
        privacyMode: "unknown",
        metadata: "{}",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        visibility: "private",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastIngestedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    await expect(
      getSessionReplaySummary("sr_anonymous", {
        userEmail: "owner@example.com",
        orgId: "org_123",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Session recording not found",
    });
  });

  it("returns playable email-keyed recordings from direct summary reads", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "sr_email_key",
        clientRecordingId: "recording_1",
        sessionId: "session_1",
        userId: "user_123",
        anonymousId: "anon_1",
        userKey: "dev@example.com",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:04.000Z",
        durationMs: 4000,
        chunkCount: 1,
        eventCount: 2,
        totalBytes: 128,
        pageCount: 1,
        errorCount: 0,
        rageClickCount: 0,
        privacyMode: "unknown",
        metadata: "{}",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        visibility: "private",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:04.000Z",
        lastIngestedAt: "2026-01-01T00:00:04.000Z",
      },
    });

    await expect(
      getSessionReplaySummary("sr_email_key", {
        userEmail: "owner@example.com",
        orgId: "org_123",
      }),
    ).resolves.toMatchObject({
      id: "sr_email_key",
      userId: "user_123",
      userKey: "dev@example.com",
      eventCount: 2,
      role: "viewer",
    });
  });

  function playableRecordingResource(id: string) {
    return {
      id,
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: "user_123",
      anonymousId: "anon_1",
      userKey: "dev@example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:04.000Z",
      durationMs: 4000,
      chunkCount: 1,
      eventCount: 2,
      totalBytes: 128,
      pageCount: 1,
      errorCount: 0,
      rageClickCount: 0,
      privacyMode: "unknown",
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      visibility: "private",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:04.000Z",
      lastIngestedAt: "2026-01-01T00:00:04.000Z",
    };
  }

  it("serves inline replay chunks as decompressed JSON (no manual gzip encoding)", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_inline"),
    });
    const eventsJson = JSON.stringify([{ type: 4, data: { href: "/inbox" } }]);
    const { db } = createReplayDbMock([
      [
        {
          seq: 0,
          checksum: "checksum_0",
          byteLength: eventsJson.length,
          eventCount: 1,
          storageKind: "inline",
          storageRef: null,
          inlineData: eventsJson,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    const result = await readSessionReplayChunkBytes("sr_inline", 0, {
      userEmail: "owner@example.com",
      orgId: "org_123",
    });

    // Returns the raw JSON string, ready to be served as application/json and
    // parsed with response.json() — no pre-gzipped body / Content-Encoding.
    expect(result.json).toBe(eventsJson);
    expect(JSON.parse(result.json)).toEqual([
      { type: 4, data: { href: "/inbox" } },
    ]);
    expect(readPrivateBlobMock).not.toHaveBeenCalled();
  });

  it("gunzips blob-stored replay chunks before serving them as JSON", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_blob"),
    });
    const eventsJson = JSON.stringify([
      { type: 2, data: { node: { id: 1 } } },
      { type: 3, data: { source: 0 } },
    ]);
    const storageRef = JSON.stringify({
      kind: "agent-native.session-replay.private-blob",
      version: 1,
      compression: "gzip",
      handle: { opaque: "blob-handle-1" },
    });
    const { db } = createReplayDbMock([
      [
        {
          seq: 1,
          checksum: "checksum_1",
          byteLength: 4096,
          eventCount: 2,
          storageKind: "blob",
          storageRef,
          inlineData: null,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);
    // Stored at rest gzipped; the read path must gunzip before serving.
    readPrivateBlobMock.mockResolvedValue({
      data: gzipSync(Buffer.from(eventsJson, "utf8")),
    });

    const result = await readSessionReplayChunkBytes("sr_blob", 1, {
      userEmail: "owner@example.com",
      orgId: "org_123",
    });

    expect(readPrivateBlobMock).toHaveBeenCalledWith({
      opaque: "blob-handle-1",
    });
    expect(result.json).toBe(eventsJson);
    expect(JSON.parse(result.json)).toHaveLength(2);
  });

  it("requires signed-in email identity and replay events in session recording lists", async () => {
    const listDb = createSessionReplayListDbMock([
      {
        id: "sr_email_key",
        clientRecordingId: "recording_1",
        sessionId: "session_1",
        userId: "user_123",
        anonymousId: "anon_1",
        userKey: "dev@example.com",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:04.000Z",
        durationMs: 4000,
        chunkCount: 1,
        eventCount: 2,
        totalBytes: 128,
        pageCount: 1,
        errorCount: 0,
        rageClickCount: 0,
        privacyMode: "unknown",
        metadata: "{}",
        ownerEmail: "owner@example.com",
        orgId: "org_123",
        visibility: "private",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastIngestedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    getDbMock.mockReturnValue(listDb.db);

    const rows = await listSessionRecordings({
      userEmail: "owner@example.com",
      orgId: "org_123",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "sr_email_key",
      userId: "user_123",
      userKey: "dev@example.com",
      chunkCount: 1,
      eventCount: 2,
    });
    const listCondition = conditionText(listDb.whereCondition);
    expect(listCondition).toContain("@");
    expect(listCondition).toContain("user_id");
    expect(listCondition).toContain("user_key");
    expect(listCondition).toContain("chunk_count");
    expect(listCondition).toContain("event_count");
    expect(listCondition).not.toContain("nullif(trim(coalesce");
  });

  it("derives replay timing from rrweb event timestamps", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userEmail: "dev@example.com",
      sequence: 2,
      status: "completed",
      timestamp: "2026-01-01T00:00:00.000Z",
      events: [
        { type: 4, timestamp: Date.parse("2026-01-01T00:00:01.000Z") },
        { type: 3, timestamp: Date.parse("2026-01-01T00:00:04.500Z") },
      ],
    });

    expect(parsed.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.endedAt).toBe("2026-01-01T00:00:04.500Z");
    expect(parsed.durationMs).toBe(4_500);
    expect(parsed.chunks[0]).toMatchObject({
      startedAt: "2026-01-01T00:00:01.000Z",
      endedAt: "2026-01-01T00:00:04.500Z",
      eventCount: 2,
    });
  });

  it("requires an Origin header when an allowlist is configured", async () => {
    await expect(
      assertReplayKeyBudget(
        {
          id: "key_1",
          replayAllowedOrigins: JSON.stringify(["https://app.example.com"]),
        },
        { requestBytes: 100 },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Origin is required for replay ingestion with this analytics public key",
    });

    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("uses aggregate ingest usage for byte and request quotas", async () => {
    const db = createBudgetDbMock([[{ bytes: 400 }], [{ requests: 119 }]]);
    getDbMock.mockReturnValue(db);

    await assertReplayKeyBudget(
      {
        id: "key_1",
        replayAllowedOrigins: "[]",
        replayMaxBytesPerDay: 1_000,
        replayMaxRequestsPerMinute: 120,
      },
      {
        requestBytes: 500,
        now: new Date("2026-01-01T00:00:00.000Z"),
      },
    );

    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("rejects requests that exceed aggregate replay byte quota", async () => {
    const db = createBudgetDbMock([[{ bytes: 900 }], [{ requests: 0 }]]);
    getDbMock.mockReturnValue(db);

    await expect(
      assertReplayKeyBudget(
        {
          id: "key_1",
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 1_000,
          replayMaxRequestsPerMinute: 120,
        },
        {
          requestBytes: 200,
          now: new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 429,
      message: "Replay ingest byte quota exceeded for this public key",
    });
  });

  it("rejects requests that exceed aggregate replay rate quota", async () => {
    const db = createBudgetDbMock([[{ bytes: 0 }], [{ requests: 120 }]]);
    getDbMock.mockReturnValue(db);

    await expect(
      assertReplayKeyBudget(
        {
          id: "key_1",
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 1_000,
          replayMaxRequestsPerMinute: 120,
        },
        {
          requestBytes: 200,
          now: new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 429,
      message: "Replay ingest rate limit exceeded for this public key",
    });
  });

  it("does not leave an empty recording when production chunk storage fails", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFallback = process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK;
    process.env.NODE_ENV = "production";
    delete process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK;
    putPrivateBlobMock.mockResolvedValue(null);
    const recording = {
      id: "sr_empty",
      publicKeyId: "key_1",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      userKey: "dev@example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      chunkCount: 0,
      eventCount: 0,
      totalBytes: 0,
      pageCount: 0,
      errorCount: 0,
      rageClickCount: 0,
      privacyMode: "unknown",
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      visibility: "private",
      status: "active",
    };
    const { db, deletes } = createReplayDbMock([
      [
        {
          id: "key_1",
          publicKey: "anpk_test",
          ownerEmail: "owner@example.com",
          orgId: "org_123",
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 100_000,
          replayMaxRequestsPerMinute: 120,
        },
      ],
      [{ bytes: 0 }],
      [{ requests: 0 }],
      [],
      [recording],
      [],
    ]);
    getDbMock.mockReturnValue(db);

    try {
      await expect(
        recordSessionReplayChunks(
          parseSessionReplayIngestPayload({
            publicKey: "anpk_test",
            replayId: "recording_1",
            sessionId: "session_1",
            userId: "dev@example.com",
            anonymousId: "anon_1",
            sequence: 0,
            events: [{ type: 4, timestamp: 1 }],
          }),
          { origin: "https://app.example.com", requestBytes: 100 },
        ),
      ).rejects.toMatchObject({
        statusCode: 503,
      });

      expect(deletes).toHaveLength(1);
      const cleanupCondition = conditionText(deletes[0]?.where);
      expect(cleanupCondition).toContain("chunk_count");
      expect(cleanupCondition).toContain("event_count");
      expect(cleanupCondition).toContain("not exists");
      expect(cleanupCondition).toContain("session_replay_chunks");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalFallback === undefined) {
        delete process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK;
      } else {
        process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK = originalFallback;
      }
    }
  });

  it("deletes uploaded replay blobs when chunk inserts fail", async () => {
    const handle = {
      opaque: "blob_1",
      provider: "test",
    };
    putPrivateBlobMock.mockResolvedValue(handle);
    deletePrivateBlobMock.mockResolvedValue({ deleted: true });
    const recording = {
      id: "sr_empty",
      publicKeyId: "key_1",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      userKey: "dev@example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      chunkCount: 0,
      eventCount: 0,
      totalBytes: 0,
      pageCount: 0,
      errorCount: 0,
      rageClickCount: 0,
      privacyMode: "unknown",
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      visibility: "private",
      status: "active",
    };
    const { db, inserts } = createReplayDbMock([
      [
        {
          id: "key_1",
          publicKey: "anpk_test",
          ownerEmail: "owner@example.com",
          orgId: "org_123",
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 100_000,
          replayMaxRequestsPerMinute: 120,
        },
      ],
      [{ bytes: 0 }],
      [{ requests: 0 }],
      [recording],
      [],
    ]);
    db.insert.mockImplementation((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        throw new Error("chunk insert failed");
      }),
    }));
    getDbMock.mockReturnValue(db);

    await expect(
      recordSessionReplayChunks(
        parseSessionReplayIngestPayload({
          publicKey: "anpk_test",
          replayId: "recording_1",
          sessionId: "session_1",
          userId: "dev@example.com",
          anonymousId: "anon_1",
          sequence: 0,
          events: [{ type: 4, timestamp: 1 }],
        }),
        { origin: "https://app.example.com", requestBytes: 100 },
      ),
    ).rejects.toThrow("chunk insert failed");

    expect(deletePrivateBlobMock).toHaveBeenCalledWith(handle);
  });

  // --- Regression coverage for the prod "empty Sessions list" root causes. ---
  // These exercise behavior the previous suite never did: the anonymous
  // cross-origin ingest path resolving storage in the key owner's org scope,
  // and recordings being written org-visible so teammates (not just the key
  // owner) can see them.

  function replayIngestKeyDbResults(orgId: string | null) {
    return [
      [
        {
          id: "key_1",
          publicKey: "anpk_test",
          ownerEmail: "owner@example.com",
          orgId,
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 100_000,
          replayMaxRequestsPerMinute: 120,
        },
      ],
      [{ bytes: 0 }],
      [{ requests: 0 }],
      [], // no existing recording -> triggers insert
      [
        {
          id: "sr_new",
          publicKeyId: "key_1",
          clientRecordingId: "recording_1",
          sessionId: "session_1",
          userId: "dev@example.com",
          anonymousId: "anon_1",
          userKey: "dev@example.com",
          startedAt: "2026-01-01T00:00:00.000Z",
          ownerEmail: "owner@example.com",
          orgId,
          chunkCount: 0,
          eventCount: 0,
          metadata: "{}",
          status: "active",
        },
      ],
      [], // existing chunks
    ];
  }

  function replayIngestPayload() {
    return parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      sequence: 0,
      events: [{ type: 4, timestamp: 1 }],
    });
  }

  it("clamps future replay recording times before inserting rows", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    putPrivateBlobMock.mockResolvedValue(null);
    const { db, inserts } = createReplayDbMock(replayIngestKeyDbResults(null));
    getDbMock.mockReturnValue(db);
    const input = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      sequence: 0,
      timestamp: "2026-07-05T12:00:00.000Z",
      events: [{ type: 4, timestamp: Date.parse("2026-07-05T12:00:01.000Z") }],
    });

    try {
      await recordSessionReplayChunks(input, {
        origin: "https://app.example.com",
        requestBytes: 100,
        now: new Date("2026-07-01T13:00:00.000Z"),
      }).catch(() => {});
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    const recordingInsert = inserts.find(
      (entry) =>
        typeof (entry.values as { clientRecordingId?: unknown })
          ?.clientRecordingId === "string",
    );
    expect((recordingInsert?.values as { startedAt: string }).startedAt).toBe(
      "2026-07-01T13:00:00.000Z",
    );
  });

  it("uploads replay chunks in the public key owner's org scope (anonymous ingest)", async () => {
    // The ingest endpoint is anonymous + cross-origin (no session). Without the
    // runWithRequestContext wrap, resolveBuilderPrivateKey()/S3 scoped-secret
    // lookups would see no user/org and every upload would 503 -> empty
    // recordings. Assert the upload runs in the key owner's scope.
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let seenEmail: string | undefined;
    let seenOrgId: string | undefined;
    putPrivateBlobMock.mockImplementation(async () => {
      seenEmail = getRequestUserEmail();
      seenOrgId = getRequestOrgId();
      return null; // force the 503 path after capturing the resolution scope
    });
    const { db } = createReplayDbMock(replayIngestKeyDbResults("org_123"));
    getDbMock.mockReturnValue(db);
    try {
      await recordSessionReplayChunks(replayIngestPayload(), {
        origin: "https://app.example.com",
        requestBytes: 100,
      }).catch(() => {});
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    expect(seenEmail).toBe("owner@example.com");
    expect(seenOrgId).toBe("org_123");
  });

  it("writes org-visible recordings for org-scoped keys", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    putPrivateBlobMock.mockResolvedValue(null);
    const { db, inserts } = createReplayDbMock(
      replayIngestKeyDbResults("org_123"),
    );
    getDbMock.mockReturnValue(db);
    try {
      await recordSessionReplayChunks(replayIngestPayload(), {
        origin: "https://app.example.com",
        requestBytes: 100,
      }).catch(() => {});
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    const recordingInsert = inserts.find(
      (entry) =>
        typeof (entry.values as { visibility?: unknown })?.visibility ===
        "string",
    );
    expect((recordingInsert?.values as { visibility: string }).visibility).toBe(
      "org",
    );
  });

  it("writes owner-private recordings when the key has no org", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    putPrivateBlobMock.mockResolvedValue(null);
    const { db, inserts } = createReplayDbMock(replayIngestKeyDbResults(null));
    getDbMock.mockReturnValue(db);
    try {
      await recordSessionReplayChunks(replayIngestPayload(), {
        origin: "https://app.example.com",
        requestBytes: 100,
      }).catch(() => {});
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    const recordingInsert = inserts.find(
      (entry) =>
        typeof (entry.values as { visibility?: unknown })?.visibility ===
        "string",
    );
    expect((recordingInsert?.values as { visibility: string }).visibility).toBe(
      "private",
    );
  });
});
