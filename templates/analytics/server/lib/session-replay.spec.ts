import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const putPrivateBlobMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: getDbMock,
  };
});

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: vi.fn(),
  putPrivateBlob: putPrivateBlobMock,
  readPrivateBlob: vi.fn(),
}));

import {
  assertReplayKeyBudget,
  parseSessionReplayIngestPayload,
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
  const deletes: Array<{ table: unknown }> = [];
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
      where: vi.fn(async () => {
        deletes.push({ table });
      }),
    })),
  };
  return { db, inserts, deletes };
}

describe("session replay ingest parsing", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    putPrivateBlobMock.mockReset();
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

  it("rejects replay payloads without a signed-in user email", () => {
    expect(() =>
      parseSessionReplayIngestPayload({
        publicKey: "anpk_test",
        replayId: "recording_1",
        sessionId: "session_1",
        anonymousId: "anon_1",
        sequence: 2,
        events: [{ type: 4, timestamp: 1 }],
      }),
    ).toThrow("Session replay requires a signed-in user email");
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
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalFallback === undefined) {
        delete process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK;
      } else {
        process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK = originalFallback;
      }
    }
  });
});
