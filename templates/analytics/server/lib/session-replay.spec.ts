import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const putPrivateBlobMock = vi.hoisted(() => vi.fn());
const deletePrivateBlobMock = vi.hoisted(() => vi.fn());
const readPrivateBlobMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());
const recordReplayFrictionMock = vi.hoisted(() => vi.fn());
const performanceMocks = vi.hoisted(() => ({
  getSessionPerformanceSummaries: vi.fn(),
  getPerformanceCoverageStart: vi.fn(),
}));
const sessionRecordingAssociationsReadyMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(true),
);

vi.mock("./session-performance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-performance.js")>()),
  getSessionPerformanceSummaries:
    performanceMocks.getSessionPerformanceSummaries,
  getPerformanceCoverageStart: performanceMocks.getPerformanceCoverageStart,
}));

vi.mock("./session-recording-associations.js", () => ({
  sessionRecordingAssociationsReady: sessionRecordingAssociationsReadyMock,
}));

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

vi.mock("./session-friction.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-friction.js")>()),
  recordReplayFriction: recordReplayFrictionMock,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    resolveAccess: resolveAccessMock,
  };
});

import { organizations } from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

import { schema } from "../db/index.js";
import {
  assertReplayKeyBudget,
  compactSessionRecordingSummary,
  extractReplayViewport,
  getSessionRecordingPerformance,
  getSessionReplaySummary,
  getSessionReplayTokenizedEvents,
  getSessionReplayTokenizedSummary,
  listJourneyRecordings,
  listSessionRecordings,
  listSessionRecordingsPage,
  MAX_REPLAY_CHUNK_READ_BATCH_BYTES,
  MAX_REPLAY_CHUNK_READ_BATCH_SIZE,
  mergeReplayMetadata,
  parseSessionReplayIngestPayload,
  readRecordingViewport,
  readSessionReplayChunkBatch,
  readSessionReplayChunkBytes,
  recordSessionReplayChunks,
  resolveSessionReplayLink,
} from "./session-replay";

afterEach(() => {
  sessionRecordingAssociationsReadyMock.mockReset();
  sessionRecordingAssociationsReadyMock.mockResolvedValue(true);
});

function createBudgetDbMock(results: unknown[][]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(results.shift() ?? [])),
      })),
    })),
  };
}

function createReplayDbMock(
  results: unknown[][],
  associationResults: unknown[][] = [],
) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const deletes: Array<{ table: unknown; where: unknown }> = [];
  const selectedTables: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          selectedTables.push(table);
          const rows =
            table === schema.sessionRecordingSessionAssociations
              ? (associationResults.shift() ?? [])
              : (results.shift() ?? []);
          return {
            limit: vi.fn(async () => rows),
            orderBy: vi.fn(async () => rows),
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
  return { db, inserts, deletes, selectedTables };
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

describe("session replay list page", () => {
  it.each([
    { offset: 9_007_199_254_740_800, total: 137 },
    { offset: 137, total: 137 },
    { offset: 0, total: 0 },
  ])(
    "avoids a row scan for offset $offset beyond total $total",
    async ({ offset, total }) => {
      const rowSelect = vi.fn(() => {
        throw new Error("Out-of-range recording row query must not run");
      });
      const db = {
        select: vi.fn((selection?: Record<string, unknown>) => {
          if (!selection) return rowSelect();
          const rows = selection.app
            ? [{ app: "clips", count: "137" }]
            : [{ count: String(total) }];
          const query = {
            from: () => query,
            where: () => query,
            groupBy: () => query,
            orderBy: () => query,
            then: (resolve: (value: unknown[]) => void) =>
              Promise.resolve(rows).then(resolve),
          };
          return query;
        }),
      };
      getDbMock.mockReturnValue(db);

      await expect(
        listSessionRecordingsPage(
          { userEmail: "qa@example.test", orgId: null },
          { offset },
        ),
      ).resolves.toEqual({
        recordings: [],
        total,
        appCounts: [{ app: "clips", count: 137 }],
      });
      expect(rowSelect).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    "rejects invalid direct offset %s before database access",
    async (offset) => {
      getDbMock.mockClear();
      await expect(
        listSessionRecordingsPage(
          { userEmail: "qa@example.test", orgId: null },
          { offset },
        ),
      ).rejects.toThrow(/offset/);
      expect(getDbMock).not.toHaveBeenCalled();
    },
  );

  it("returns a real filtered total and app counts before pagination", async () => {
    const conditions: unknown[] = [];
    const orders: unknown[][] = [];
    const db = {
      select: vi.fn((selection?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn((condition: unknown) => {
            if (table === organizations) {
              return {
                limit: async () => [
                  { allowedDomain: null, createdBy: "owner@builder.io" },
                ],
              };
            }
            if (table !== schema.sessionRecordings)
              throw new Error("Unexpected table in session list query");
            conditions.push(condition);
            const result = selection?.app
              ? [{ app: "clips", count: "137" }]
              : selection?.count
                ? [{ count: "137" }]
                : [];
            const query = {
              orderBy: (...values: unknown[]) => {
                orders.push(values);
                return query;
              },
              groupBy: () => query,
              limit: () => query,
              offset: async () => result,
              then: (resolve: (value: unknown[]) => void) =>
                Promise.resolve(result).then(resolve),
            };
            return query;
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const page = await listSessionRecordingsPage(
      { userEmail: "owner@builder.io", orgId: "org_123" },
      {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T23:59:59.999Z",
        app: "clips",
        hideEmpty: true,
        hasNetworkErrors: true,
        visitorType: "internal",
        sort: "longest",
        offset: 100,
        limit: 50,
      },
    );

    expect(page).toEqual({
      recordings: [],
      total: 137,
      appCounts: [{ app: "clips", count: 137 }],
    });
    expect(conditions).toHaveLength(3);
    expect(conditionText(conditions[0])).toContain("clips");
    expect(conditionText(conditions[0])).toContain("builder.io");
    expect(conditionText(conditions[1])).not.toContain("clips");
    expect(conditionText(conditions[2])).toContain("clips");
    expect(conditionText(orders[1])).toContain("nulls last");
  });

  it("filters by exact observed sessions while retaining replay and access scope", async () => {
    const conditions: unknown[] = [];
    const db = {
      select: vi.fn((selection?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn((condition: unknown) => {
            if (table === organizations) return { limit: async () => [] };
            conditions.push(condition);
            const rows = selection?.app
              ? [{ app: "clips", count: "1" }]
              : selection?.count
                ? [{ count: "1" }]
                : [];
            const query = {
              orderBy: () => query,
              groupBy: () => query,
              limit: () => query,
              offset: async () => rows,
              then: (resolve: (value: unknown[]) => void) =>
                Promise.resolve(rows).then(resolve),
            };
            return query;
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    await listSessionRecordingsPage(
      { userEmail: "viewer@example.test", orgId: "org_1" },
      { sessionId: "s-observed", query: "s-observed" },
    );

    expect(conditions).toHaveLength(3);
    const where = conditions.map(conditionText).join(" ");
    expect(where).toContain("session_recording_session_associations");
    expect(where).toContain("not exists");
    expect(where).toContain("s-observed");
    expect(where).toContain("owner_email");
    expect(where).toContain("org_id");
    expect(where).toContain("chunk_count");
    expect(where).toContain("event_count");
  });

  it("uses the legacy pointer for replay filters and search before associations migrate", async () => {
    sessionRecordingAssociationsReadyMock.mockResolvedValue(false);
    const conditions: unknown[] = [];
    const db = {
      select: vi.fn((selection?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn((where: unknown) => {
            if (table === organizations) return { limit: async () => [] };
            conditions.push(where);
            const rows = selection?.count ? [{ count: "1" }] : [];
            const query = {
              orderBy: () => query,
              groupBy: () => query,
              limit: () => query,
              offset: async () => rows,
              then: (resolve: (value: unknown[]) => void) =>
                Promise.resolve(rows).then(resolve),
            };
            return query;
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    await listSessionRecordingsPage(
      { userEmail: "viewer@example.test", orgId: "org_1" },
      { sessionId: "legacy-session", query: "legacy-session" },
    );

    const where = conditions.map(conditionText).join(" ");
    expect(where).not.toContain("session_recording_session_associations");
    expect(where).toContain("legacy-session");
    expect(where).toContain("owner_email");
    expect(where).toContain("org_id");
    expect(where).toContain("chunk_count");
    expect(where).toContain("event_count");
  });

  it("uses observed sessions in the simple recording list", async () => {
    let condition: unknown;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((where: unknown) => {
            condition = where;
            return {
              orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
            };
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    await expect(
      listSessionRecordings(
        { userEmail: "viewer@example.test", orgId: "org_1" },
        { sessionId: "s-observed" },
      ),
    ).resolves.toEqual([]);

    const where = conditionText(condition);
    expect(where).toContain("session_recording_session_associations");
    expect(where).toContain("not exists");
    expect(where).toContain("s-observed");
    expect(where).toContain("owner_email");
    expect(where).toContain("org_id");
    expect(where).toContain("chunk_count");
    expect(where).toContain("event_count");
  });

  it("filters the simple list by the legacy pointer before associations migrate", async () => {
    sessionRecordingAssociationsReadyMock.mockResolvedValue(false);
    let condition: unknown;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((where: unknown) => {
            condition = where;
            return {
              orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
            };
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    await listSessionRecordings(
      { userEmail: "viewer@example.test", orgId: "org_1" },
      { sessionId: "legacy-session" },
    );

    const where = conditionText(condition);
    expect(where).not.toContain("session_recording_session_associations");
    expect(where).toContain("legacy-session");
    expect(where).toContain("owner_email");
    expect(where).toContain("org_id");
  });

  it("filters explicit anonymous sessions without trusting capture claims", async () => {
    const conditions: unknown[] = [];
    const anonymousRecording = {
      id: "sr_pre_auth",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: null,
      anonymousId: "anon_1",
      userKey: "anon_1",
      startedAt: "2026-10-08T00:00:00.000Z",
      chunkCount: 1,
      eventCount: 2,
      metadata:
        '{"route":"/signup","capture_context":"pre_auth","pre_auth_base_path":"/app"}',
      ownerEmail: "owner@example.test",
      orgId: "org_1",
      visibility: "org",
      status: "completed",
    };
    const db = {
      select: vi.fn((selection?: Record<string, unknown>) => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn((condition: unknown) => {
            if (table === organizations) {
              return { limit: async () => [] };
            }
            conditions.push(condition);
            const rows = selection?.app
              ? [{ app: null, count: "1" }]
              : selection?.count
                ? [{ count: "1" }]
                : [anonymousRecording];
            const query = {
              orderBy: () => query,
              groupBy: () => query,
              limit: () => query,
              offset: async () => rows,
              then: (resolve: (value: unknown[]) => void) =>
                Promise.resolve(rows).then(resolve),
            };
            return query;
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const page = await listSessionRecordingsPage(
      { userEmail: "owner@example.test", orgId: "org_1" },
      { visitorType: "anonymous" },
    );

    expect(page.recordings).toMatchObject([
      {
        id: "sr_pre_auth",
        userId: null,
        anonymousId: "anon_1",
        metadata: { route: "/signup" },
      },
    ]);
    expect(conditionText(conditions[0])).not.toContain("capture_context");
    expect(conditionText(conditions[0])).not.toContain("pre_auth");
    expect(conditionText(conditions[0])).toContain("anonymous_id");
    expect(conditionText(conditions[0])).toContain("owner_email");
    expect(conditionText(conditions[0])).toContain("org_id");
    expect(conditionText(conditions[0])).toContain("user_id");
    expect(conditionText(conditions[0])).toContain("user_key");
  });
});

describe("journey replay lookup during association migration", () => {
  it("lists readable legacy recordings without joining the missing table", async () => {
    sessionRecordingAssociationsReadyMock.mockResolvedValue(false);
    const recording = {
      id: "sr_legacy",
      sessionId: "legacy-session",
      startedAt: "2026-10-08T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      metadata: "{}",
    };
    let selection: Record<string, unknown> | undefined;
    let condition: unknown;
    const db = {
      select: vi.fn((selected: Record<string, unknown>) => {
        selection = selected;
        return {
          from: vi.fn((table: unknown) => {
            expect(table).toBe(schema.sessionRecordings);
            return {
              where: vi.fn((where: unknown) => {
                condition = where;
                return {
                  orderBy: vi.fn(() => ({
                    limit: vi.fn(async () => [recording]),
                  })),
                };
              }),
            };
          }),
        };
      }),
    };
    getDbMock.mockReturnValue(db);

    await expect(
      listJourneyRecordings(
        { userEmail: "viewer@example.test", orgId: "org_1" },
        ["legacy-session"],
        {
          fromIso: "2026-10-07T00:00:00.000Z",
          toIso: "2026-10-09T00:00:00.000Z",
        },
      ),
    ).resolves.toMatchObject({
      recordings: [{ id: "sr_legacy", sessionId: "legacy-session" }],
      complete: true,
    });
    expect(selection?.sessionId).toBe(schema.sessionRecordings.sessionId);
    expect(conditionText(condition)).not.toContain(
      "session_recording_session_associations",
    );
    expect(conditionText(condition)).toContain("owner_email");
    expect(conditionText(condition)).toContain("org_id");
  });
});

describe("session recording performance", () => {
  const summary = {
    ttfbMs: null,
    lcpMs: 4_200,
    inpMs: null,
    cls: null,
    slowRequests: null,
    maxRequestMs: null,
    atLeast: [],
    incomplete: false,
  };

  beforeEach(() => {
    performanceMocks.getPerformanceCoverageStart.mockResolvedValue(
      "2026-09-20T00:00:00.000Z",
    );
    performanceMocks.getSessionPerformanceSummaries.mockImplementation(
      async () => new Map([["r1", summary]]),
    );
  });

  it("reads only recordings the viewer can access, and says which were never measured", async () => {
    const rows = [
      {
        id: "r1",
        sessionId: "s1",
        ownerEmail: "owner@example.test",
        orgId: "org_1",
      },
      {
        id: "r2",
        sessionId: "s2",
        ownerEmail: "owner@example.test",
        orgId: "org_1",
      },
    ];
    let condition: unknown;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((where: unknown) => {
            condition = where;
            return { limit: vi.fn(async () => rows) };
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    const result = await getSessionRecordingPerformance(
      { userEmail: "viewer@example.test", orgId: "org_1" },
      ["r1", "r2", "r1", "r-unreadable"],
    );

    expect(result).toEqual({
      performance: { r1: summary, r2: null },
      coverageStartedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(conditionText(condition)).toContain("viewer@example.test");
    expect(conditionText(condition)).toContain("r-unreadable");
    expect(
      performanceMocks.getSessionPerformanceSummaries,
    ).toHaveBeenCalledWith(
      { userEmail: "viewer@example.test", orgId: "org_1" },
      rows,
    );
  });

  it("reports coverage without reading recordings when given no ids", async () => {
    const db = { select: vi.fn() };
    getDbMock.mockReturnValue(db);

    await expect(
      getSessionRecordingPerformance(
        { userEmail: "viewer@example.test", orgId: null },
        [],
      ),
    ).resolves.toEqual({
      performance: {},
      coverageStartedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("session replay agent summaries", () => {
  it("omits owner, org, visibility, and metadata from compact agent payloads", () => {
    const summary = compactSessionRecordingSummary({
      id: "sr_1",
      clientRecordingId: "client_1",
      sessionId: "session_1",
      userId: "user_1",
      anonymousId: null,
      userKey: "user@example.test",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:30.000Z",
      durationMs: 30_000,
      chunkCount: 1,
      eventCount: 10,
      totalBytes: 2048,
      pageCount: 1,
      errorCount: 0,
      networkErrorCount: 0,
      rageClickCount: 0,
      privacyMode: "default",
      firstUrl: "https://example.test/start",
      lastUrl: "https://example.test/end",
      path: "/end",
      hostname: "example.test",
      referrer: "https://referrer.example.test",
      app: "analytics",
      template: "web",
      status: "completed",
      metadata: { secret: "do-not-return" },
      ownerEmail: "owner@example.test",
      orgId: "org_1",
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:30.000Z",
      lastIngestedAt: "2026-01-01T00:00:30.000Z",
      role: "owner",
      canEdit: true,
      canManage: true,
    });

    expect(summary).toMatchObject({
      id: "sr_1",
      clientRecordingId: "client_1",
      sessionId: "session_1",
      totalBytes: 2048,
      referrer: "https://referrer.example.test",
      lastIngestedAt: "2026-01-01T00:00:30.000Z",
    });
    expect(summary).not.toHaveProperty("ownerEmail");
    expect(summary).not.toHaveProperty("orgId");
    expect(summary).not.toHaveProperty("visibility");
    expect(summary).not.toHaveProperty("metadata");
    expect(summary).not.toHaveProperty("canManage");
  });
});

describe("session replay ingest parsing", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    getDbMock.mockReset();
    putPrivateBlobMock.mockReset();
    deletePrivateBlobMock.mockReset();
    readPrivateBlobMock.mockReset();
    resolveAccessMock.mockReset();
    recordReplayFrictionMock.mockReset();
  });

  it("rejects ids too long to index instead of failing the insert", () => {
    const events = [{ type: 4, timestamp: 1, data: { href: "/" } }];
    const tooLong = "s".repeat(257);
    for (const ids of [
      { sessionId: tooLong },
      { sessionId: "session_1", replayId: tooLong },
    ]) {
      expect(() =>
        parseSessionReplayIngestPayload({
          publicKey: "anpk_test",
          sequence: 0,
          events,
          ...ids,
        }),
      ).toThrow(
        expect.objectContaining({
          statusCode: 400,
          message:
            "Replay session and recording ids must be at most 256 characters",
        }),
      );
    }
    expect(
      parseSessionReplayIngestPayload({
        publicKey: "anpk_test",
        sessionId: "s".repeat(256),
        sequence: 0,
        events,
      }).sessionId,
    ).toHaveLength(256);
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

  it("drops NUL and lone surrogates before deriving fields and chunks", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording\u0000_1",
      sessionId: "session\u0000_1",
      userId: "dev@example.com\uD83D",
      sequence: 0,
      events: [
        {
          type: 4,
          timestamp: 1,
          data: {
            href: "https://example.com/a\u0000b",
            "no\u0000te": "x\uDE00",
          },
        },
      ],
    });

    expect(parsed).toMatchObject({
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com�",
    });
    expect(JSON.parse(parsed.chunks[0].inlineData ?? "")).toEqual([
      {
        type: 4,
        timestamp: 1,
        data: { href: "https://example.com/ab", note: "x�" },
      },
    ]);
  });

  it("derives error and network-error counts from tagged diagnostics events", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      sequence: 0,
      events: [
        { type: 4, timestamp: 1, data: { href: "https://example.com" } },
        {
          type: 5,
          timestamp: 2,
          data: {
            tag: "agent-native.console",
            payload: {
              level: "error",
              source: "console",
              message: "boom",
              repeat: 3,
            },
          },
        },
        {
          type: 5,
          timestamp: 3,
          data: {
            tag: "agent-native.console",
            payload: { level: "warn", source: "console", message: "meh" },
          },
        },
        {
          type: 5,
          timestamp: 4,
          data: {
            tag: "agent-native.network",
            payload: {
              api: "fetch",
              method: "GET",
              url: "/api/broken",
              status: 500,
              ok: false,
              durationMs: 12,
            },
          },
        },
        {
          type: 5,
          timestamp: 5,
          data: {
            tag: "agent-native.network",
            payload: {
              api: "xhr",
              method: "POST",
              url: "/api/dropped",
              status: 0,
              ok: false,
              durationMs: 8,
              error: "network failure",
            },
          },
        },
        {
          type: 5,
          timestamp: 6,
          data: {
            tag: "agent-native.network",
            payload: {
              api: "fetch",
              method: "GET",
              url: "/api/fine",
              status: 200,
              ok: true,
              durationMs: 5,
            },
          },
        },
        { type: 5, timestamp: 7, data: { message: "Uncaught error thing" } },
      ],
    });

    expect(parsed.errorCount).toBe(3);
    expect(parsed.networkErrorCount).toBe(2);
  });

  it("falls back to the substring heuristic when no tagged diagnostics exist", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      userId: "dev@example.com",
      sequence: 0,
      events: [
        { type: 4, timestamp: 1, data: { href: "https://example.com" } },
        { type: 5, timestamp: 2, data: { message: "Uncaught TypeError" } },
        { type: 5, timestamp: 3, data: { type: "unhandledrejection" } },
        { type: 3, timestamp: 4, data: { source: 2, type: 2 } },
      ],
    });

    expect(parsed.errorCount).toBe(2);
    expect(parsed.networkErrorCount).toBe(0);
  });

  it("detects rage clicks from repeated clicks on one target", () => {
    const click = (timestamp: number, id: number) => ({
      type: 3,
      timestamp,
      data: { source: 2, type: 2, id, x: 10, y: 10 },
    });
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      sequence: 0,
      events: [
        click(1_000, 7),
        click(1_002, 7),
        click(1_400, 7),
        click(9_000, 8),
        click(30_000, 8),
      ],
    });

    expect(parsed.rageClickCount).toBe(1);
  });

  it("does not count deliberate, spread-out clicks as rage clicks", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      sequence: 0,
      events: [
        { type: 3, timestamp: 1_000, data: { source: 2, type: 2, id: 7 } },
        { type: 3, timestamp: 4_000, data: { source: 2, type: 2, id: 7 } },
        { type: 3, timestamp: 7_000, data: { source: 2, type: 2, id: 7 } },
      ],
    });

    expect(parsed.rageClickCount).toBe(0);
  });

  it("keeps a client-reported rage click count when the recorder sends one", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      sequence: 0,
      rageClickCount: 4,
      events: [{ type: 3, timestamp: 1, data: { source: 2, type: 2, id: 7 } }],
    });

    expect(parsed.rageClickCount).toBe(4);
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

  it("drops client auth-context claims from replay properties and metadata", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      anonymousId: "anon_1",
      sequence: 0,
      properties: {
        capture_context: "pre_auth",
        pre_auth_base_path: "/app",
      },
      metadata: {
        capture_context: "forged",
        pre_auth_base_path: "/forged",
        retained: true,
      },
      events: [{ type: 4, timestamp: 1 }],
    });
    const unmarked = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_2",
      sessionId: "session_2",
      anonymousId: "anon_2",
      sequence: 0,
      properties: { capture_context: "pre_auth" },
      metadata: { capture_context: "pre_auth" },
      events: [{ type: 4, timestamp: 1 }],
    });

    expect(parsed.metadata).toEqual({ retained: true });
    expect(parsed).not.toHaveProperty("preAuthCaptureContextRequested");
    expect(parsed).not.toHaveProperty("preAuthBasePath");
    expect(unmarked.metadata).toEqual({});
    expect(unmarked).not.toHaveProperty("preAuthCaptureContextRequested");
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

  it("rejects anonymous recordings without an anonymous id", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        id: "sr_anonymous",
        clientRecordingId: "recording_1",
        sessionId: "session_1",
        userId: null,
        anonymousId: null,
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

  it("returns client-submitted anonymous recordings only through scoped detail access", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        ...playableRecordingResource("sr_pre_auth"),
        userId: null,
        anonymousId: "anon_1",
        userKey: "anon_1",
        metadata: "{}",
      },
    });

    await expect(
      getSessionReplaySummary("sr_pre_auth", {
        userEmail: "viewer@example.test",
        orgId: "org_1",
      }),
    ).resolves.toMatchObject({
      id: "sr_pre_auth",
      userId: null,
      anonymousId: "anon_1",
      role: "viewer",
      metadata: {},
    });
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "session-recording",
      "sr_pre_auth",
      { userEmail: "viewer@example.test", orgId: "org_1" },
    );
  });

  it("keeps anonymous read-by-id behind the existing resource ACL", async () => {
    resolveAccessMock.mockResolvedValue(null);

    await expect(
      getSessionReplaySummary("sr_anonymous_outside_scope", {
        userEmail: "viewer@example.test",
        orgId: "org_1",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Session recording not found",
    });
    expect(resolveAccessMock).toHaveBeenCalledWith(
      "session-recording",
      "sr_anonymous_outside_scope",
      { userEmail: "viewer@example.test", orgId: "org_1" },
    );
  });

  it("resolves anonymous replay links within owner scope", async () => {
    const anonymousRecording = {
      id: "sr_pre_auth",
      startedAt: "2026-10-08T00:00:00.000Z",
      endedAt: "2026-10-08T00:01:00.000Z",
      durationMs: 60_000,
      ownerEmail: "owner@example.test",
      orgId: "org_1",
      visibility: "org",
      chunkCount: 1,
      eventCount: 2,
      userId: null,
      userKey: "anon_1",
      anonymousId: "anon_1",
      metadata: "{}",
    };
    let selection: Record<string, unknown> | undefined;
    let condition: unknown;
    const db = {
      select: vi.fn((selected: Record<string, unknown>) => {
        selection = selected;
        return {
          from: vi.fn(() => ({
            where: vi.fn((where: unknown) => {
              condition = where;
              return { limit: async () => [anonymousRecording] };
            }),
          })),
        };
      }),
    };
    getDbMock.mockReturnValue(db);

    await expect(
      resolveSessionReplayLink(
        {
          sessionId: "session_1",
          clientRecordingId: "recording_1",
          at: "2026-10-08T00:00:00.000Z",
        },
        { userEmail: "owner@example.test", orgId: "org_1" },
      ),
    ).resolves.toMatchObject({
      recordingId: "sr_pre_auth",
      offsetMs: 0,
      path: "/sessions/sr_pre_auth?atMs=0",
    });
    expect(selection).toMatchObject({
      anonymousId: schema.sessionRecordings.anonymousId,
      metadata: schema.sessionRecordings.metadata,
    });
    expect(conditionText(condition)).toContain("owner_email");
    expect(conditionText(condition)).toContain("org_id");
    expect(conditionText(condition)).toContain(
      "session_recording_session_associations",
    );
  });

  it("resolves replay links through the legacy pointer before associations migrate", async () => {
    sessionRecordingAssociationsReadyMock.mockResolvedValue(false);
    const recording = {
      id: "sr_legacy",
      startedAt: "2026-10-08T00:00:00.000Z",
      endedAt: "2026-10-08T00:01:00.000Z",
      durationMs: 60_000,
      ownerEmail: "owner@example.test",
      orgId: "org_1",
      visibility: "org",
      chunkCount: 1,
      eventCount: 2,
      userId: null,
      userKey: "anon_1",
      anonymousId: "anon_1",
      metadata: "{}",
    };
    let condition: unknown;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((where: unknown) => {
            condition = where;
            return { limit: async () => [recording] };
          }),
        })),
      })),
    };
    getDbMock.mockReturnValue(db);

    await expect(
      resolveSessionReplayLink(
        {
          sessionId: "legacy-session",
          clientRecordingId: "recording_1",
          at: "2026-10-08T00:00:00.000Z",
        },
        { userEmail: "owner@example.test", orgId: "org_1" },
      ),
    ).resolves.toMatchObject({ recordingId: "sr_legacy" });
    expect(conditionText(condition)).not.toContain(
      "session_recording_session_associations",
    );
    expect(conditionText(condition)).toContain("legacy-session");
    expect(conditionText(condition)).toContain("owner_email");
    expect(conditionText(condition)).toContain("org_id");
  });

  it("returns compact recording data from tokenized event reads", async () => {
    const eventsJson = JSON.stringify([
      { type: 4, timestamp: 1000, data: { href: "https://example.test" } },
    ]);
    const { db } = createReplayDbMock([
      [
        {
          ...playableRecordingResource("sr_agent"),
          metadata: JSON.stringify({ secret: "do-not-return" }),
        },
      ],
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

    const result = await getSessionReplayTokenizedEvents(
      "sr_agent",
      "owner@example.com",
      { limit: 10 },
    );

    expect(result.eventCount).toBe(1);
    expect(result.chunks[0]?.events).toEqual([
      { type: 4, timestamp: 1000, data: { href: "https://example.test" } },
    ]);
    expect(result.recording).toMatchObject({
      id: "sr_agent",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      totalBytes: 128,
    });
    expect(result.recording).not.toHaveProperty("metadata");
    expect(result.recording).not.toHaveProperty("ownerEmail");
    expect(result.recording).not.toHaveProperty("orgId");
    expect(result.recording).not.toHaveProperty("visibility");
    expect(result.recording).not.toHaveProperty("canEdit");
    expect(result.recording).not.toHaveProperty("canManage");
  });

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

  it("returns actionable setup guidance when a replay blob key does not match", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_blob_mismatch"),
    });
    const storageRef = JSON.stringify({
      kind: "agent-native.session-replay.private-blob",
      version: 1,
      compression: "gzip",
      handle: { opaque: "encrypted-blob-handle" },
    });
    const { db } = createReplayDbMock([
      [
        {
          seq: 0,
          checksum: "checksum_0",
          byteLength: 4096,
          eventCount: 2,
          storageKind: "blob",
          storageRef,
          inlineData: null,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);
    readPrivateBlobMock.mockRejectedValue(
      new Error("Unsupported state or unable to authenticate data"),
    );

    await expect(
      readSessionReplayChunkBytes("sr_blob_mismatch", 0, {
        userEmail: "owner@example.com",
        orgId: "org_123",
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("ANALYTICS_SECRETS_ENCRYPTION_KEY"),
    });
  });

  it("reads an ordered replay chunk batch with one access check and one row query", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_batch"),
    });
    const firstJson = JSON.stringify([{ type: 4, timestamp: 1000 }]);
    const secondJson = JSON.stringify([{ type: 3, timestamp: 2000 }]);
    const { db } = createReplayDbMock([
      [
        {
          seq: 1,
          checksum: "checksum_1",
          byteLength: secondJson.length,
          eventCount: 1,
          storageKind: "inline",
          storageRef: null,
          inlineData: secondJson,
        },
        {
          seq: 2,
          checksum: "checksum_2",
          byteLength: firstJson.length,
          eventCount: 1,
          storageKind: "inline",
          storageRef: null,
          inlineData: firstJson,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    const result = await readSessionReplayChunkBatch("sr_batch", [2, 1], {
      userEmail: "viewer@example.com",
      orgId: "org_123",
    });

    expect(resolveAccessMock).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(result.chunks.map((chunk) => chunk.seq)).toEqual([2, 1]);
    expect(result.chunks[0]?.events).toEqual([{ type: 4, timestamp: 1000 }]);
    expect(result.unavailableChunks).toBe(0);
  });

  it("bounds replay chunk batches by count and declared bytes before blob reads", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_batch_bounds"),
    });

    await expect(
      readSessionReplayChunkBatch(
        "sr_batch_bounds",
        Array.from(
          { length: MAX_REPLAY_CHUNK_READ_BATCH_SIZE + 1 },
          (_, index) => index,
        ),
        { userEmail: "viewer@example.com", orgId: "org_123" },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    const storageRef = JSON.stringify({
      kind: "agent-native.session-replay.private-blob",
      version: 1,
      compression: "gzip",
      handle: { opaque: "oversized" },
    });
    const { db } = createReplayDbMock([
      [
        {
          seq: 0,
          checksum: "checksum_0",
          byteLength: MAX_REPLAY_CHUNK_READ_BATCH_BYTES + 1,
          eventCount: 1,
          storageKind: "blob",
          storageRef,
          inlineData: null,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      readSessionReplayChunkBatch("sr_batch_bounds", [0], {
        userEmail: "viewer@example.com",
        orgId: "org_123",
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(readPrivateBlobMock).not.toHaveBeenCalled();
  });

  it("limits replay chunk blob reads to ten and marks missing chunks unavailable", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_batch_concurrency"),
    });
    const eventsJson = JSON.stringify([{ type: 4, timestamp: 1000 }]);
    const rows = Array.from({ length: 15 }, (_, seq) => ({
      seq,
      checksum: `checksum_${seq}`,
      byteLength: eventsJson.length,
      eventCount: 1,
      storageKind: "blob",
      storageRef: JSON.stringify({
        kind: "agent-native.session-replay.private-blob",
        version: 1,
        compression: "gzip",
        handle: { opaque: `blob-${seq}` },
      }),
      inlineData: null,
    }));
    const { db } = createReplayDbMock([rows]);
    getDbMock.mockReturnValue(db);
    let activeReads = 0;
    let maxActiveReads = 0;
    readPrivateBlobMock.mockImplementation(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return { data: gzipSync(Buffer.from(eventsJson, "utf8")) };
    });

    const result = await readSessionReplayChunkBatch(
      "sr_batch_concurrency",
      [...rows.map((row) => row.seq), 19],
      { userEmail: "viewer@example.com", orgId: "org_123" },
    );

    expect(maxActiveReads).toBe(10);
    expect(result.chunks[result.chunks.length - 1]).toMatchObject({
      seq: 19,
      events: [],
      unavailable: true,
    });
    expect(result.unavailableChunks).toBe(1);
  });

  it("rejects replay chunk batches whose actual JSON response exceeds the cap", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_batch_actual_size"),
    });
    const oversizedJson = JSON.stringify([
      { data: "x".repeat(MAX_REPLAY_CHUNK_READ_BATCH_BYTES) },
    ]);
    const { db } = createReplayDbMock([
      [
        {
          seq: 0,
          checksum: "checksum_0",
          byteLength: 1,
          eventCount: 1,
          storageKind: "inline",
          storageRef: null,
          inlineData: oversizedJson,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      readSessionReplayChunkBatch("sr_batch_actual_size", [0], {
        userEmail: "viewer@example.com",
        orgId: "org_123",
      }),
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it("fails a replay chunk batch on systemic blob read errors", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: playableRecordingResource("sr_batch_storage_error"),
    });
    const storageRef = JSON.stringify({
      kind: "agent-native.session-replay.private-blob",
      version: 1,
      compression: "gzip",
      handle: { opaque: "unreadable" },
    });
    const { db } = createReplayDbMock([
      [
        {
          seq: 0,
          checksum: "checksum_0",
          byteLength: 10,
          eventCount: 1,
          storageKind: "blob",
          storageRef,
          inlineData: null,
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);
    readPrivateBlobMock.mockRejectedValue(new Error("provider unavailable"));

    await expect(
      readSessionReplayChunkBatch("sr_batch_storage_error", [0], {
        userEmail: "viewer@example.com",
        orgId: "org_123",
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
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

  it("keeps all authorized session identities in browser-demo mode", async () => {
    const listDb = createSessionReplayListDbMock([
      {
        id: "sr_builder_one",
        clientRecordingId: "recording_1",
        sessionId: "session_1",
        userId: "alice@builder.io",
        anonymousId: "anon_1",
        userKey: "alice@builder.io",
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
        metadata: JSON.stringify({
          accountEmail: "alice@builder.io",
          note: "Viewed by alice@builder.io",
        }),
        ownerEmail: "owner@builder.io",
        orgId: "org_123",
        visibility: "private",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastIngestedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "sr_external",
        clientRecordingId: "recording_2",
        sessionId: "session_2",
        userId: "customer@example.com",
        anonymousId: "anon_2",
        userKey: "customer@example.com",
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
        ownerEmail: "owner@builder.io",
        orgId: "org_123",
        visibility: "private",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastIngestedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "sr_builder_two",
        clientRecordingId: "recording_3",
        sessionId: "session_3",
        userId: "bob@builder.io",
        anonymousId: "anon_3",
        userKey: "bob@builder.io",
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
        ownerEmail: "owner@builder.io",
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
      userEmail: "owner@builder.io",
      orgId: "org_123",
    });

    expect(rows.map((row) => row.id)).toEqual([
      "sr_builder_one",
      "sr_external",
      "sr_builder_two",
    ]);
    expect(rows[0]).toMatchObject({
      userId: "alice@builder.io",
      userKey: "alice@builder.io",
      ownerEmail: "owner@builder.io",
      metadata: {
        accountEmail: "alice@builder.io",
        note: "Viewed by alice@builder.io",
      },
    });
    expect(rows[1]).toMatchObject({
      userId: "customer@example.com",
      userKey: "customer@example.com",
      ownerEmail: "owner@builder.io",
    });
    const listCondition = conditionText(listDb.whereCondition);
    expect(listCondition).not.toContain("%@builder.io");
  });

  it("keeps real identities in direct summaries", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        ...playableRecordingResource("sr_builder_detail"),
        userId: "detail@builder.io",
        userKey: "detail@builder.io",
        metadata: JSON.stringify({ actorEmail: "detail@builder.io" }),
        ownerEmail: "owner@builder.io",
      },
    });

    const summary = await getSessionReplaySummary("sr_builder_detail", {
      userEmail: "owner@builder.io",
      orgId: "org_123",
    });
    const compact = compactSessionRecordingSummary(summary);

    expect(summary).toMatchObject({
      userId: "detail@builder.io",
      userKey: "detail@builder.io",
      ownerEmail: "owner@builder.io",
      metadata: { actorEmail: "detail@builder.io" },
    });
    expect(compact).toMatchObject({
      userId: "detail@builder.io",
      userKey: "detail@builder.io",
    });
  });

  it("keeps real identities in tokenized summaries", async () => {
    const { db } = createReplayDbMock([
      [
        {
          ...playableRecordingResource("sr_builder_agent_link"),
          userId: "detail@builder.io",
          userKey: "detail@builder.io",
          ownerEmail: "owner@builder.io",
          metadata: JSON.stringify({ actorEmail: "detail@builder.io" }),
        },
      ],
    ]);
    getDbMock.mockReturnValue(db);

    const summary = await getSessionReplayTokenizedSummary(
      "sr_builder_agent_link",
      "owner@builder.io",
    );

    expect(summary).toMatchObject({
      userId: "detail@builder.io",
      userKey: "detail@builder.io",
      ownerEmail: "owner@builder.io",
      metadata: { actorEmail: "detail@builder.io" },
    });
  });

  it("returns external identities from authorized direct summary reads", async () => {
    resolveAccessMock.mockResolvedValue({
      role: "viewer",
      resource: {
        ...playableRecordingResource("sr_external_detail"),
        userId: "customer@example.com",
        userKey: "customer@example.com",
      },
    });

    await expect(
      getSessionReplaySummary("sr_external_detail", {
        userEmail: "owner@builder.io",
        orgId: "org_123",
      }),
    ).resolves.toMatchObject({
      userId: "customer@example.com",
      userKey: "customer@example.com",
    });
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

  it("keeps a recording active while the recorder says so, despite its end time", () => {
    const payload = {
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      sequence: 0,
      endedAt: "2026-01-01T00:00:04.500Z",
      events: [{ type: 3, timestamp: Date.parse("2026-01-01T00:00:04.500Z") }],
    };

    expect(
      parseSessionReplayIngestPayload({ ...payload, status: "active" }).status,
    ).toBe("active");
    expect(
      parseSessionReplayIngestPayload({ ...payload, status: "completed" })
        .status,
    ).toBe("completed");
    expect(parseSessionReplayIngestPayload(payload).status).toBe("completed");
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
      retryAfterSeconds: 24 * 60 * 60,
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
      retryAfterSeconds: 60,
    });
  });

  it("rejects a new recording at 90% of the daily byte budget", async () => {
    const db = createBudgetDbMock([[{ bytes: 900 }]]);
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
          requestBytes: 10,
          now: new Date("2026-01-01T00:00:00.000Z"),
          isNewRecording: true,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 429,
      message: "Replay ingest byte quota exceeded for this public key",
      retryAfterSeconds: 24 * 60 * 60,
    });
  });

  it("accepts an existing recording at 90% of the daily byte budget", async () => {
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
          requestBytes: 10,
          now: new Date("2026-01-01T00:00:00.000Z"),
          isNewRecording: false,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("still rejects an existing recording above the hard daily byte cap", async () => {
    const db = createBudgetDbMock([[{ bytes: 1_000 }]]);
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
          requestBytes: 10,
          now: new Date("2026-01-01T00:00:00.000Z"),
          isNewRecording: false,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 429,
      message: "Replay ingest byte quota exceeded for this public key",
      retryAfterSeconds: 24 * 60 * 60,
    });
  });

  it("does not leave an empty recording when production chunk storage fails", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFallback = process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK;
    process.env.NODE_ENV = "production";
    process.env.ANALYTICS_SESSION_REPLAY_SQL_FALLBACK = "1";
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
      [{ bytes: 0 }], // assertReplayKeyBudget's daily SUM (100% cap)
      [{ requests: 0 }], // per-minute COUNT
      [], // no existing recording -> triggers insert
      [{ bytes: 0 }], // new-recording admission SUM (85% ceiling)
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

      expect(deletes).toHaveLength(2);
      expect(deletes[0]?.table).toBe(schema.sessionReplayIngests);
      const cleanupCondition = conditionText(deletes[1]?.where);
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

  it("rejects a rate-limited ingest before looking up the recording", async () => {
    const { db, inserts } = createReplayDbMock([
      [
        {
          id: "key_1",
          publicKey: "anpk_test",
          ownerEmail: "owner@example.com",
          orgId: "org_123",
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 100_000,
          replayMaxRequestsPerMinute: 2,
        },
      ],
      [{ bytes: 0 }],
      [{ requests: 2 }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      recordSessionReplayChunks(
        parseSessionReplayIngestPayload({
          publicKey: "anpk_test",
          replayId: "recording_1",
          sessionId: "session_1",
          userId: "dev@example.com",
          sequence: 0,
          events: [{ type: 4, timestamp: 1 }],
        }),
        { origin: "https://app.example.com", requestBytes: 100 },
      ),
    ).rejects.toMatchObject({ statusCode: 429, retryAfterSeconds: 60 });

    expect(db.select).toHaveBeenCalledTimes(3);
    expect(inserts).toHaveLength(0);
  });

  it("stores nothing for a test identity's replay and says why", async () => {
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
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      recordSessionReplayChunks(
        parseSessionReplayIngestPayload({
          publicKey: "anpk_test",
          replayId: "recording_1",
          sessionId: "session_1",
          userEmail: "qa+autoz@builder.io",
          sequence: 0,
          events: [{ type: 4, timestamp: 1 }],
        }),
        { origin: "https://app.example.com", requestBytes: 100 },
      ),
    ).resolves.toEqual({ skipped: "test-identity", acceptedChunks: 0 });

    expect(db.select).toHaveBeenCalledTimes(3);
    expect(inserts).toHaveLength(0);
    expect(putPrivateBlobMock).not.toHaveBeenCalled();
  });

  it("removes a new recording's placeholder when the usage reservation fails", async () => {
    const recording = {
      id: "sr_new",
      publicKeyId: "key_1",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      startedAt: "2026-01-01T00:00:00.000Z",
      chunkCount: 0,
      eventCount: 0,
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: "org_123",
    };
    const { db, inserts, deletes } = createReplayDbMock([
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
      [{ bytes: 0 }], // assertReplayKeyBudget's daily SUM (100% cap)
      [{ requests: 0 }], // per-minute COUNT
      [], // no existing recording -> placeholder insert
      [{ bytes: 0 }], // new-recording admission SUM (85% ceiling)
      [recording],
      [],
    ]);
    db.insert.mockImplementation((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        if (table === schema.sessionReplayIngests) {
          throw new Error("reservation insert failed");
        }
        return { onConflictDoNothing: vi.fn(async () => undefined) };
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
    ).rejects.toThrow("reservation insert failed");

    expect(putPrivateBlobMock).not.toHaveBeenCalled();
    const placeholderCleanup = deletes.find(
      (entry) => entry.table === schema.sessionRecordings,
    );
    expect(placeholderCleanup).toBeDefined();
    expect(conditionText(placeholderCleanup?.where)).toContain("chunk_count");
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
    const { db, inserts, deletes } = createReplayDbMock([
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
      [{ bytes: 0 }], // assertReplayKeyBudget's daily SUM (100% cap)
      [{ requests: 0 }], // per-minute COUNT
      [recording], // existing recording found directly, no reselect
      [],
    ]);
    db.insert.mockImplementation((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        if (table === schema.sessionReplayChunks) {
          throw new Error("chunk insert failed");
        }
        return { onConflictDoNothing: vi.fn(async () => undefined) };
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

    const reservation = inserts.find(
      (entry) => entry.table === schema.sessionReplayIngests,
    );
    const reservedId = (reservation?.values as { id: string } | undefined)?.id;
    expect(reservedId).toBeTruthy();
    const reservationDelete = deletes.find(
      (entry) => entry.table === schema.sessionReplayIngests,
    );
    expect(reservationDelete).toBeDefined();
    expect(conditionText(reservationDelete?.where)).toContain(reservedId);
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
      [{ bytes: 0 }], // assertReplayKeyBudget's daily SUM (100% cap)
      [{ requests: 0 }], // per-minute COUNT
      [], // no existing recording -> triggers insert
      [{ bytes: 0 }], // new-recording admission SUM (85% ceiling)
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

  it("preserves the last known legacy session when a recording gains associations", async () => {
    const recording = {
      id: "sr_legacy",
      publicKeyId: "key_1",
      clientRecordingId: "recording_1",
      sessionId: "legacy-session",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      userKey: "dev@example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      chunkCount: 1,
      eventCount: 1,
      totalBytes: 100,
      pageCount: 1,
      errorCount: 0,
      networkErrorCount: 0,
      rageClickCount: 0,
      privacyMode: "unknown",
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      status: "active",
    };
    const oldChunk = {
      id: "src_old",
      recordingId: "sr_legacy",
      seq: 0,
      checksum: "old-checksum",
      byteLength: 100,
      eventCount: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      storageKind: "inline",
      storageRef: null,
      inlineData: "[]",
      ownerEmail: "owner@example.com",
      orgId: null,
    };
    const keyResults = replayIngestKeyDbResults(null);
    const { db, inserts } = createReplayDbMock(
      [...keyResults.slice(0, 3), [recording], [oldChunk]],
      [[]],
    );
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    }));
    getDbMock.mockReturnValue({ ...db, update });
    putPrivateBlobMock.mockResolvedValue(null);

    await recordSessionReplayChunks(
      parseSessionReplayIngestPayload({
        publicKey: "anpk_test",
        replayId: "recording_1",
        sessionId: "new-session",
        userId: "dev@example.com",
        anonymousId: "anon_1",
        sequence: 1,
        events: [{ type: 4, timestamp: 2 }],
      }),
      { origin: "https://app.example.com", requestBytes: 100 },
    );

    const associationInsert = inserts.find(
      (entry) => entry.table === schema.sessionRecordingSessionAssociations,
    );
    expect(
      (associationInsert?.values as Array<{ sessionId: string }>)
        .map((row) => row.sessionId)
        .sort(),
    ).toEqual(["legacy-session", "new-session"]);
  });

  it("does not associate a rotated session when an ingest only retries duplicate chunks", async () => {
    const input = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "rotated-session",
      userId: "dev@example.com",
      sequence: 0,
      events: [{ type: 4, timestamp: 1 }],
    });
    const [duplicateChunk] = input.chunks;
    const recording = {
      id: "sr_existing",
      publicKeyId: "key_1",
      clientRecordingId: "recording_1",
      sessionId: "original-session",
      userId: "dev@example.com",
      anonymousId: "anon_1",
      userKey: "dev@example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      chunkCount: 1,
      eventCount: 1,
      totalBytes: 100,
      pageCount: 1,
      errorCount: 0,
      networkErrorCount: 0,
      rageClickCount: 0,
      privacyMode: "unknown",
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      status: "active",
    };
    const oldChunk = {
      id: "src_old",
      recordingId: recording.id,
      seq: duplicateChunk!.seq,
      checksum: duplicateChunk!.checksum,
      byteLength: duplicateChunk!.byteLength,
      eventCount: duplicateChunk!.eventCount,
      startedAt: duplicateChunk!.startedAt,
      endedAt: duplicateChunk!.endedAt,
      storageKind: "inline",
      storageRef: null,
      inlineData: duplicateChunk!.inlineData,
      ownerEmail: recording.ownerEmail,
      orgId: recording.orgId,
    };
    const keyResults = replayIngestKeyDbResults(null);
    const { db, inserts, selectedTables } = createReplayDbMock(
      [...keyResults.slice(0, 3), [recording], [oldChunk]],
      [[]],
    );
    const updateValues: Array<Record<string, unknown>> = [];
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateValues.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    }));
    getDbMock.mockReturnValue({ ...db, update });

    await expect(
      recordSessionReplayChunks(input, {
        origin: "https://app.example.com",
        requestBytes: 100,
      }),
    ).resolves.toMatchObject({ acceptedChunks: 0, duplicateChunks: 1 });

    expect(selectedTables).not.toContain(
      schema.sessionRecordingSessionAssociations,
    );
    expect(
      inserts.some(
        (entry) => entry.table === schema.sessionRecordingSessionAssociations,
      ),
    ).toBe(false);
    expect(updateValues[0]).toMatchObject({ sessionId: "original-session" });
    expect(recordReplayFrictionMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "original-session", newChunks: [] }),
    );
  });

  it("stores replay chunks without association queries during migration", async () => {
    sessionRecordingAssociationsReadyMock.mockResolvedValue(false);
    const { db, inserts, selectedTables } = createReplayDbMock(
      replayIngestKeyDbResults(null),
    );
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    }));
    getDbMock.mockReturnValue({ ...db, update });
    putPrivateBlobMock.mockResolvedValue(null);

    await expect(
      recordSessionReplayChunks(replayIngestPayload(), {
        origin: "https://app.example.com",
      }),
    ).resolves.toMatchObject({ acceptedChunks: 1 });

    expect(selectedTables).not.toContain(
      schema.sessionRecordingSessionAssociations,
    );
    expect(
      inserts.some(
        (entry) => entry.table === schema.sessionRecordingSessionAssociations,
      ),
    ).toBe(false);
    expect(
      inserts.some((entry) => entry.table === schema.sessionReplayChunks),
    ).toBe(true);
  });

  it("does not persist caller auth-page context claims to replay metadata", async () => {
    const { db, inserts } = createReplayDbMock(replayIngestKeyDbResults(null));
    const updateValues: Array<Record<string, unknown>> = [];
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateValues.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    }));
    getDbMock.mockReturnValue({ ...db, update });
    putPrivateBlobMock.mockResolvedValue(null);

    const input = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      anonymousId: "anon_1",
      sequence: 0,
      url: "https://app.example.com/signup?source=invite",
      properties: {
        capture_context: "pre_auth",
        pre_auth_base_path: "/app",
      },
      metadata: {
        capture_context: "pre_auth",
        pre_auth_base_path: "/forged",
        route: "/signup",
        retained: true,
      },
      events: [{ type: 4, timestamp: 1 }],
    });
    await recordSessionReplayChunks(input, {
      origin: "https://app.example.com",
      requestBytes: 100,
    });

    const recordingInsert = inserts.find(
      (entry) => entry.table === schema.sessionRecordings,
    )?.values as { metadata: string } | undefined;
    expect(JSON.parse(recordingInsert?.metadata ?? "{}")).toEqual({
      route: "/signup",
      retained: true,
    });
    expect(JSON.parse(String(updateValues[0]?.metadata ?? "{}"))).toEqual({
      route: "/signup",
      retained: true,
    });
  });

  it("does not promote an existing identified recording from an auth-page marker", async () => {
    const existingRecording = {
      id: "sr_existing",
      publicKeyId: "key_1",
      clientRecordingId: "recording_1",
      sessionId: "session_1",
      userId: "known@example.com",
      anonymousId: null,
      userKey: "known@example.com",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
      chunkCount: 0,
      eventCount: 0,
      totalBytes: 0,
      pageCount: 0,
      errorCount: 0,
      networkErrorCount: 0,
      rageClickCount: 0,
      privacyMode: "unknown",
      metadata: "{}",
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      status: "active",
    };
    const { db } = createReplayDbMock([
      [
        {
          id: "key_1",
          publicKey: "anpk_test",
          ownerEmail: "owner@example.com",
          orgId: null,
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 100_000,
          replayMaxRequestsPerMinute: 120,
        },
      ],
      [{ bytes: 0 }],
      [{ requests: 0 }],
      [existingRecording],
      [],
    ]);
    const updateValues: Array<Record<string, unknown>> = [];
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateValues.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    }));
    getDbMock.mockReturnValue({ ...db, update });
    putPrivateBlobMock.mockResolvedValue(null);

    await recordSessionReplayChunks(
      parseSessionReplayIngestPayload({
        publicKey: "anpk_test",
        replayId: "recording_1",
        sessionId: "session_1",
        userId: "known@example.com",
        sequence: 0,
        url: "https://app.example.com/signup",
        properties: { capture_context: "pre_auth" },
        events: [{ type: 4, timestamp: 1 }],
      }),
      { origin: "https://app.example.com", requestBytes: 100 },
    );

    expect(updateValues[0]).toMatchObject({ userId: "known@example.com" });
    expect(
      JSON.parse(String(updateValues[0]?.metadata ?? "{}")).capture_context,
    ).toBeUndefined();
  });

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
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let seenEmail: string | undefined;
    let seenOrgId: string | undefined;
    putPrivateBlobMock.mockImplementation(async () => {
      seenEmail = getRequestUserEmail();
      seenOrgId = getRequestOrgId();
      return null;
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

  it("measures friction for exactly the chunks a batch stored, after the ones before it", async () => {
    // Stored as a blob, the chunk row has no inline data; friction must still
    // read the events the upload carried.
    putPrivateBlobMock.mockResolvedValue({
      opaque: "blob_1",
      provider: "test",
    });
    const input = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      sequence: 1,
      status: "active",
      endedAt: 1,
      events: [{ type: 4, timestamp: 1 }],
    });
    const [key, bytes, requests, , , recording] =
      replayIngestKeyDbResults(null);
    const { db, inserts } = createReplayDbMock([
      key,
      bytes,
      requests,
      [{ ...recording[0], chunkCount: 1, errorCount: 2, rageClickCount: 1 }],
      [{ seq: 0, checksum: "earlier", eventCount: 1, byteLength: 10 }],
    ]);
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    }));
    getDbMock.mockReturnValue({ ...db, update });
    await recordSessionReplayChunks(input, {
      origin: "https://app.example.com",
      requestBytes: 100,
    });
    expect(
      inserts.find((entry) => entry.table === schema.sessionReplayChunks)
        ?.values,
    ).toEqual([
      expect.objectContaining({
        seq: 1,
        storageKind: "blob",
        inlineData: null,
      }),
    ]);
    expect(recordReplayFrictionMock).toHaveBeenCalledTimes(1);
    expect(recordReplayFrictionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "sr_new",
        sessionId: "session_1",
        ownerEmail: "owner@example.com",
        orgId: null,
        priorChunkCount: 1,
        newChunks: [{ seq: 1, inlineData: input.chunks[0]!.inlineData }],
        errorCount: 2,
        rageClickCount: 1,
        recordingEnded: false,
      }),
    );
    expect(
      inserts.find(
        (entry) => entry.table === schema.sessionRecordingSessionAssociations,
      )?.values,
    ).toEqual([
      expect.objectContaining({
        recordingId: "sr_new",
        sessionId: "session_1",
      }),
    ]);
  });

  it("creates no session_recordings row when admission control rejects a new recording", async () => {
    const { db, inserts } = createReplayDbMock([
      [
        {
          id: "key_1",
          publicKey: "anpk_test",
          ownerEmail: "owner@example.com",
          orgId: "org_123",
          replayAllowedOrigins: "[]",
          replayMaxBytesPerDay: 1_000,
          replayMaxRequestsPerMinute: 120,
        },
      ],
      [{ bytes: 0 }], // assertReplayKeyBudget's daily SUM at the 100% cap -> passes
      [{ requests: 0 }], // per-minute COUNT -> passes
      [], // no existing recording
      [{ bytes: 900 }], // 90% used -> above the 85% new-recording ceiling
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      recordSessionReplayChunks(replayIngestPayload(), {
        origin: "https://app.example.com",
        requestBytes: 10,
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(inserts).toHaveLength(0);
  });

  it("reserves usage before uploading chunk blobs or inserting chunk rows", async () => {
    // Regression coverage for the admission race: the usage row must land
    // before the slow blob upload, not after, or concurrent first chunks can
    // all read the same pre-reservation total and overshoot the budget.
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const order: string[] = [];
    putPrivateBlobMock.mockImplementation(async () => {
      order.push("blob-upload");
      return { opaque: "blob_1", provider: "test" };
    });
    const { db } = createReplayDbMock(replayIngestKeyDbResults("org_123"));
    db.insert.mockImplementation((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        if (table === schema.sessionReplayIngests) order.push("reserve-usage");
        if (table === schema.sessionReplayChunks) order.push("insert-chunks");
        return { onConflictDoNothing: vi.fn(async () => undefined) };
      }),
    }));
    (db as { update?: unknown }).update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    }));
    getDbMock.mockReturnValue(db);

    try {
      await recordSessionReplayChunks(replayIngestPayload(), {
        origin: "https://app.example.com",
        requestBytes: 100,
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(order).toEqual(["reserve-usage", "blob-upload", "insert-chunks"]);
  });

  it("deletes the reserved usage row when a chunk upload fails", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    putPrivateBlobMock.mockRejectedValue(new Error("upload failed"));
    const { db, inserts, deletes } = createReplayDbMock(
      replayIngestKeyDbResults("org_123"),
    );
    getDbMock.mockReturnValue(db);

    try {
      await expect(
        recordSessionReplayChunks(replayIngestPayload(), {
          origin: "https://app.example.com",
          requestBytes: 100,
        }),
      ).rejects.toThrow("upload failed");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    const reservation = inserts.find(
      (entry) => entry.table === schema.sessionReplayIngests,
    );
    const reservedId = (reservation?.values as { id: string } | undefined)?.id;
    expect(reservedId).toBeTruthy();
    const reservationDelete = deletes.find(
      (entry) => entry.table === schema.sessionReplayIngests,
    );
    expect(reservationDelete).toBeDefined();
    expect(conditionText(reservationDelete?.where)).toContain(reservedId);
  });
  it("stores the first Meta size and the last known size on a new recording", async () => {
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
      sequence: 0,
      metadata: { sdk: "test", viewport: { first: { width: 1, height: 1 } } },
      events: [
        {
          type: 4,
          timestamp: 1,
          data: { href: "/", width: 1440, height: 900 },
        },
        {
          type: 3,
          timestamp: 2,
          data: { source: 4, width: 1280, height: 720 },
        },
      ],
    });
    try {
      await recordSessionReplayChunks(input, {
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
    const metadata = JSON.parse(
      (recordingInsert?.values as { metadata: string }).metadata,
    );
    expect(metadata).toEqual({
      sdk: "test",
      viewport: {
        first: { width: 1440, height: 900 },
        last: { width: 1280, height: 720 },
      },
    });
    expect(readRecordingViewport(JSON.stringify(metadata))).toEqual({
      status: "known",
      width: 1440,
      height: 900,
    });
  });
});

describe("replay viewport", () => {
  const meta = (width: unknown, height: unknown, timestamp = 1) => ({
    type: 4,
    timestamp,
    data: { href: "/", width, height },
  });
  const resize = (width: unknown, height: unknown, timestamp = 2) => ({
    type: 3,
    timestamp,
    data: { source: 4, width, height },
  });

  it("reads the first Meta as first and the latest Meta or resize as last", () => {
    expect(
      extractReplayViewport([
        { type: 2, timestamp: 0, data: {} },
        meta(1440, 900),
        resize(1000, 700),
        meta(390, 844, 3),
        resize(400, 800, 4),
      ]),
    ).toEqual({
      first: { width: 1440, height: 900 },
      last: { width: 400, height: 800 },
    });
  });

  it("returns null, not a guess, when no Meta carries a size", () => {
    expect(extractReplayViewport([])).toBeNull();
    expect(extractReplayViewport([meta(undefined, 900)])).toBeNull();
    // A resize alone is a last size with no known start.
    expect(extractReplayViewport([resize(800, 600)])).toEqual({
      first: null,
      last: { width: 800, height: 600 },
    });
  });

  it("skips impossible sizes and non-resize incremental events", () => {
    expect(
      extractReplayViewport([
        meta(0, 900),
        meta(-5, 900),
        meta(999_999, 900),
        // Each side is allowed alone; together they are a 67-megapixel surface.
        meta(8_192, 8_192),
        { type: 3, timestamp: 2, data: { source: 3, width: 10, height: 10 } },
        meta("1280", "720"),
      ]),
    ).toEqual({
      first: { width: 1280, height: 720 },
      last: { width: 1280, height: 720 },
    });
  });

  it("keeps the stored first size across uploads and takes the newest last size", () => {
    const first = mergeReplayMetadata(
      {},
      { sdk: "x" },
      {
        first: { width: 1440, height: 900 },
        last: { width: 1440, height: 900 },
      },
    );
    const second = mergeReplayMetadata(
      first,
      {},
      {
        first: { width: 390, height: 844 },
        last: { width: 400, height: 800 },
      },
    );
    expect(second).toEqual({
      sdk: "x",
      viewport: {
        first: { width: 1440, height: 900 },
        last: { width: 400, height: 800 },
      },
    });
  });

  it("drops client auth-context claims from merged metadata across later uploads", () => {
    const first = mergeReplayMetadata(
      {},
      {
        capture_context: "pre_auth",
        pre_auth_base_path: "/app",
        route: "/signup",
      },
      {
        first: { width: 1440, height: 900 },
        last: { width: 1440, height: 900 },
      },
    );
    const second = mergeReplayMetadata(
      { ...first, capture_context: "pre_auth" },
      {
        capture_context: "forged",
        pre_auth_base_path: "/other",
        route: "/signup/verify",
        app: "analytics",
      },
      { first: null, last: { width: 390, height: 844 } },
    );

    expect(second).toEqual({
      route: "/signup/verify",
      app: "analytics",
      viewport: {
        first: { width: 1440, height: 900 },
        last: { width: 390, height: 844 },
      },
    });
  });

  it("takes a later resize as the last size, and stores nothing without a first size", () => {
    const stored = mergeReplayMetadata(
      {},
      {},
      {
        first: { width: 1440, height: 900 },
        last: { width: 1440, height: 900 },
      },
    );
    expect(
      mergeReplayMetadata(
        stored,
        {},
        { first: null, last: { width: 700, height: 500 } },
      ),
    ).toEqual({
      viewport: {
        first: { width: 1440, height: 900 },
        last: { width: 700, height: 500 },
      },
    });
    expect(
      mergeReplayMetadata(
        {},
        {},
        { first: null, last: { width: 700, height: 500 } },
      ),
    ).toEqual({});
  });

  it("leaves a stored viewport alone when an upload carries none", () => {
    const stored = {
      viewport: {
        first: { width: 1, height: 2 },
        last: { width: 3, height: 4 },
      },
    };
    expect(mergeReplayMetadata(stored, { other: 1 })).toEqual({
      ...stored,
      other: 1,
    });
    expect(mergeReplayMetadata({}, { other: 1 })).toEqual({ other: 1 });
  });

  it("keeps server metadata outside the caller metadata cap", () => {
    const maxBytes = 16 * 1024;
    const metadata = {
      payload: "x".repeat(maxBytes - JSON.stringify({ payload: "" }).length),
    };
    expect(JSON.stringify(metadata)).toHaveLength(maxBytes);

    const viewport = {
      first: { width: 1440, height: 900 },
      last: { width: 1440, height: 900 },
    };
    const merged = mergeReplayMetadata(
      {},
      { ...metadata, capture_context: "pre_auth" },
      viewport,
    );

    expect(merged).toEqual({ payload: metadata.payload, viewport });
    expect(JSON.stringify(merged).length).toBeGreaterThan(maxBytes);
    expect(() =>
      mergeReplayMetadata({}, { payload: "x".repeat(maxBytes) }),
    ).toThrow("Replay metadata must be 16384 bytes or smaller");
  });

  it("drops a client-sent viewport at parse time", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      sequence: 0,
      metadata: { viewport: { first: { width: 5, height: 5 } }, keep: true },
      events: [{ type: 2, timestamp: 1, data: {} }],
    });
    expect(parsed.metadata).toEqual({ keep: true });
    expect(parsed.viewport).toBeNull();
  });

  it("tells a recording without a stored size from one it cannot read", () => {
    expect(readRecordingViewport("{}")).toEqual({ status: "not_captured" });
    expect(readRecordingViewport(null)).toEqual({ status: "not_captured" });
    expect(readRecordingViewport("{not json")).toEqual({
      status: "unreadable",
    });
    expect(readRecordingViewport("[]")).toEqual({ status: "unreadable" });
    expect(readRecordingViewport('{"viewport":"wide"}')).toEqual({
      status: "unreadable",
    });
    expect(
      readRecordingViewport('{"viewport":{"first":{"width":0,"height":9}}}'),
    ).toEqual({
      status: "unreadable",
    });
  });
});

describe("listJourneyRecordings", () => {
  const row = (id: string) => ({
    id,
    sessionId: "s1",
    startedAt: "2026-10-01T12:00:00.000Z",
    endedAt: "2026-10-01T12:01:00.000Z",
    durationMs: 60_000,
    metadata: "{}",
  });
  const readWith = async (rows: unknown[]) => {
    const limits: number[] = [];
    let condition: unknown;
    const query = {
      where: vi.fn((where: unknown) => {
        condition = where;
        return query;
      }),
      orderBy: vi.fn(() => ({
        limit: vi.fn(async (n: number) => {
          limits.push(n);
          return rows.slice(0, n);
        }),
      })),
    };
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => query),
        })),
      })),
    });
    const read = await listJourneyRecordings(
      { userEmail: "owner@example.com", orgId: null },
      ["s1"],
      {
        fromIso: "2026-09-30T00:00:00.000Z",
        toIso: "2026-10-03T00:00:00.000Z",
      },
    );
    return { read, limits, condition };
  };

  it("uses the legacy session only when a recording has no associations", async () => {
    const { read, condition } = await readWith([row("legacy")]);

    expect(read.recordings[0]).toMatchObject({
      id: "legacy",
      sessionId: "s1",
    });
    const where = conditionText(condition);
    expect(where).toContain("session_recording_session_associations");
    expect(where).toContain("session_recordings_session_id_unique");
    expect(where).toContain("is null");
  });

  it("reads one row past the ceiling, so a batch that ends exactly there is complete", async () => {
    const five = ["r1", "r2", "r3", "r4", "r5"].map(row);
    const { read, limits } = await readWith(five);
    expect(limits).toEqual([6]);
    expect(read.complete).toBe(true);
    expect(read.recordings).toHaveLength(5);
  });

  it("reports an incomplete read, and keeps only the ceiling, when more rows exist", async () => {
    const six = ["r1", "r2", "r3", "r4", "r5", "r6"].map(row);
    const { read } = await readWith(six);
    expect(read.complete).toBe(false);
    expect(read.recordings).toHaveLength(5);
  });
});
