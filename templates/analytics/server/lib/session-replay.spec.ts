import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return {
    ...actual,
    getDb: getDbMock,
  };
});

import {
  assertReplayKeyBudget,
  parseSessionReplayIngestPayload,
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

describe("session replay ingest parsing", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it("normalizes recorder payloads into session recording chunks", () => {
    const parsed = parseSessionReplayIngestPayload({
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
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
});
