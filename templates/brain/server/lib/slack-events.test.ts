import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: null as null | {
    id: string;
    contentHash: string | null;
    sensitivityPolicyVersion: string | null;
    audienceAclHash: string | null;
  },
  captureUpdate: null as null | Record<string, unknown>,
  captureAudienceDeleted: false,
  invalidateDerivedForCapture: vi.fn(async () => undefined),
  enqueueBrainOperation: vi.fn(async () => undefined),
  enqueueCaptureInvalidation: vi.fn(async () => undefined),
  retireUpstreamDeletedCapture: vi.fn(async () => true),
}));

vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (mocks.capture ? [mocks.capture] : []),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          mocks.captureUpdate = values;
          return { where: async () => undefined };
        },
      }),
      delete: () => ({
        where: async () => {
          mocks.captureAudienceDeleted = true;
        },
      }),
    }),
  };
});

vi.mock("./brain.js", () => ({
  parseJson: <T>(value: string | null | undefined, fallback: T): T => {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  },
  retireUpstreamDeletedCapture: mocks.retireUpstreamDeletedCapture,
}));

vi.mock("./ingest-queue.js", () => ({
  enqueueBrainOperation: mocks.enqueueBrainOperation,
  enqueueCaptureInvalidation: mocks.enqueueCaptureInvalidation,
}));

vi.mock("./source-credentials.js", () => ({
  resolveSourceCredential: vi.fn(async () => null),
}));

import {
  parseSlackEventsEnvelope,
  retireSlackThreadCapture,
  slackEventDirective,
  verifySlackEventSignature,
} from "./slack-events.js";

describe("Brain Slack events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capture = null;
    mocks.captureUpdate = null;
    mocks.captureAudienceDeleted = false;
  });

  it("accepts a fresh correctly signed event and rejects replay or tampering", () => {
    const rawBody = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event: { type: "message", channel: "C123", ts: "1770919200.000100" },
    });
    const timestamp = "1770919200";
    const signingSecret = "test-signing-secret";
    const signature = `v0=${crypto
      .createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    expect(
      verifySlackEventSignature({
        rawBody,
        timestamp,
        signature,
        signingSecret,
        nowMs: 1_770_919_300_000,
      }),
    ).toBe(true);
    expect(
      verifySlackEventSignature({
        rawBody: `${rawBody} `,
        timestamp,
        signature,
        signingSecret,
        nowMs: 1_770_919_300_000,
      }),
    ).toBe(false);
    expect(
      verifySlackEventSignature({
        rawBody,
        timestamp,
        signature,
        signingSecret,
        nowMs: 1_770_919_600_001,
      }),
    ).toBe(false);
  });

  it("parses only a JSON envelope and leaves provider payload handling to the verified path", () => {
    expect(parseSlackEventsEnvelope("not json")).toBeNull();
    expect(
      parseSlackEventsEnvelope(
        JSON.stringify({
          type: "url_verification",
          team_id: "T123",
          challenge: "challenge-token",
        }),
      ),
    ).toMatchObject({ type: "url_verification", team_id: "T123" });
  });

  it("routes Slack deletions to capture retirement instead of thread refresh", () => {
    expect(
      slackEventDirective({
        event: {
          type: "message",
          subtype: "message_deleted",
          channel: "C123",
          deleted_ts: "1770919200.000100",
        },
      }),
    ).toEqual({
      action: "retire",
      channelId: "C123",
      threadTs: "1770919200.000100",
    });
    expect(
      slackEventDirective({
        event: {
          type: "message",
          subtype: "message_deleted",
          channel: "G123",
          deleted_ts: "1770919200.000200",
          previous_message: {
            ts: "1770919200.000200",
            thread_ts: "1770919200.000100",
          },
        },
      }),
    ).toEqual({
      action: "retire",
      channelId: "G123",
      threadTs: "1770919200.000100",
    });
  });

  it("records a durable upstream tombstone for a deleted Slack capture", async () => {
    await expect(
      retireSlackThreadCapture({
        sourceId: "source-1",
        channelId: "C123",
        threadTs: "1770919200.000100",
      }),
    ).resolves.toBe(true);

    expect(mocks.retireUpstreamDeletedCapture).toHaveBeenCalledWith({
      sourceId: "source-1",
      externalId: "slack:C123:1770919200.000100",
      provider: "slack",
    });
  });
});
